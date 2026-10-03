import { analyze, cacheKey } from './analysis.mjs';
import { accounts, accountStore, migrateAccount } from './accounts.mjs';
import { getMessages } from './gmail.mjs';
export function createSingleService(store, env, dependencies = {}) {
  const fetchMessages = dependencies.getMessages || getMessages;
  const summarize = dependencies.analyze || analyze;
  const request = dependencies.fetch || fetch;
  let running = false;
  let lastError = null;
  const provider = env.AI_PROVIDER || 'gemini';
  if (!['gemini', 'ollama'].includes(provider)) throw new Error('AI_PROVIDER must be gemini or ollama');
  const model = provider === 'gemini' ? env.GEMINI_MODEL || 'gemini-2.5-flash-lite' : env.OLLAMA_MODEL || 'qwen3:8b';
  const config = {
    provider,
    model,
    apiKey: env.GEMINI_API_KEY,
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434'
  };
  const dailyLimit = Number(env.DAILY_ANALYSIS_LIMIT || 100);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) throw new Error('Invalid daily analysis limit');
  const settings = async () => await store.get('settings', {
    notifications: false,
    importantOnly: true,
    analysisConsent: false
  });
  async function usage() {
    const day = new Date().toISOString().slice(0, 10);
    const saved = await store.get('usage');
    return saved?.day === day ? saved : {
      day,
      calls: 0,
      tokens: 0,
      cacheHits: 0
    };
  }
  async function deliver() {
    const prefs = await settings();
    const token = await store.get('pushToken');
    if (!prefs.notifications || !token) return;
    for (const notification of await store.get('outbox', [])) {
      const response = await request('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          to: token,
          title: 'Your inbox has an update',
          body: 'Open Briefmail to read your new email summary.',
          data: {
            mailId: dependencies.accountId ? `${dependencies.accountId}:${notification.id}` : notification.id
          },
          sound: 'default',
          channelId: 'mail'
        })
      });
      if (!response.ok) throw new Error('Notification delivery failed');
      const result = await response.json();
      if (result.data?.status !== 'ok') {
        if (result.data?.details?.error === 'DeviceNotRegistered') await store.set('pushToken', null);
        throw new Error('Notification service rejected the device token');
      }
      await store.set('outbox', (await store.get('outbox', [])).filter(n => n.id !== notification.id));
    }
  }
  return {
    async status() {
      return {
        connected: Boolean(await store.get('google')),
        provider,
        model,
        syncing: running,
        lastSync: await store.get('lastSync'),
        lastError,
        usage: await usage(),
        dailyLimit,
        settings: await settings()
      };
    },
    settings,
    async sync() {
      if (running) return {
        busy: true
      };
      running = true;
      try {
        if (!(await store.get('google'))) throw new Error('Connect Gmail first');
        if (!(await settings()).analysisConsent) throw new Error('Enable email analysis in settings first');
        if (provider === 'gemini' && !env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY on the server');
        lastError = null;
        let added = 0;
        const batch = await fetchMessages(store, env);
        let budgetExhausted = false;
        for (const mail of batch.messages) {
          if ((await store.get('mails', [])).some(m => m.id === mail.id)) continue;
          const key = 'cache:' + cacheKey(mail, provider, model);
          let result = await store.get(key);
          const used = await usage();
          if (result) {
            used.cacheHits++;
            await store.set('usage', used);
          } else {
            if (used.calls >= dailyLimit) {
              budgetExhausted = true;
              break;
            }
            // Reserve before the network call: retries and failures also consume the daily allowance.
            used.calls++;
            await store.set('usage', used);
            result = await summarize(mail, config);
            used.tokens += result.tokens || 0;
            await store.set('usage', used);
            await store.set(key, result);
          }
          const {
            body,
            ...metadata
          } = mail;
          await store.set('mails', [...(await store.get('mails', [])), {
            ...metadata,
            ...result,
            read: false,
            archived: false
          }].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
          const prefs = await settings();
          // Avoid notifying for historical backfill. The summary remains in the inbox.
          if (prefs.notifications && (!prefs.importantOnly || result.priority === 'high') && Date.parse(mail.receivedAt) > ((await store.get('connectedAt')) || Date.now())) {
            await store.set('outbox', [...(await store.get('outbox', [])), {
              id: mail.id
            }]);
          }
          added++;
        }
        if (!budgetExhausted) await store.set('page', batch.nextPage);
        await store.set('lastSync', new Date().toISOString());
        await deliver();
        return {
          added,
          budgetExhausted,
          hasMore: Boolean(batch.nextPage)
        };
      } catch (error) {
        lastError = 'Sync could not finish. Check provider credentials, daily limits, and server connectivity, then retry.';
        throw error;
      } finally {
        running = false;
      }
    },
    busy() {
      return running;
    }
  };
}
export async function createService(store, env, dependencies = {}) {
  await migrateAccount(store);
  let running = false;
  let accountMutation = false;
  const workers = new Map();
  const worker = id => {
    if (!workers.has(id)) workers.set(id, createSingleService(accountStore(store, id), env, {
      ...dependencies,
      accountId: id
    }));
    return workers.get(id);
  };
  const globalService = createSingleService(store, env, dependencies);
  const service = {
    busy: () => running || accountMutation,
    setAccountMutation: value => {
      accountMutation = value;
    },
    settings: globalService.settings,
    async status() {
      const list = await Promise.all((await accounts(store)).map(async a => {
        const state = await worker(a.id).status();
        return {
          ...a,
          settings: await accountStore(store, a.id).get('preferences', {
            notifications: true,
            importantOnly: true
          }),
          lastSync: state.lastSync,
          lastError: state.lastError
        };
      }));
      return {
        ...(await globalService.status()),
        connected: list.length > 0,
        syncing: running,
        accounts: list,
        lastSync: await store.get('lastSync'),
        lastError: list.some(a => a.lastError) ? 'Some accounts could not sync. Check their status below.' : null
      };
    },
    async sync() {
      if (running) return {
        busy: true
      };
      if (accountMutation) return {
        busy: true
      };
      running = true;
      try {
        const list = await accounts(store);
        if (!list.length) throw new Error('Connect Gmail first');
        if (!(await globalService.settings()).analysisConsent) throw new Error('Enable email analysis in settings first');
        const total = {
          added: 0,
          budgetExhausted: false,
          hasMore: false,
          failedAccounts: []
        };
        // Rotate first account so a backfill cannot permanently monopolize the shared budget.
        const offset = (await store.get('syncTurn', 0)) % list.length;
        await store.set('syncTurn', offset + 1);
        for (const a of [...list.slice(offset), ...list.slice(0, offset)]) {
          try {
            const result = await worker(a.id).sync();
            total.added += result.added;
            total.budgetExhausted ||= result.budgetExhausted;
            total.hasMore ||= result.hasMore;
          } catch {
            total.failedAccounts.push(a.id);
          }
        }
        await store.set('lastSync', new Date().toISOString());
        return total;
      } finally {
        running = false;
      }
    }
  };
  return {
    ...service,
    sync: () => store.exclusive ? store.exclusive(() => service.sync()) : service.sync()
  };
}
