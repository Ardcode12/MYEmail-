import { randomUUID } from 'node:crypto';
export const accounts = async store => await store.get('accounts', []);
export function accountStore(store, id) {
  return {
    async get(key, fallback = null) {
      if (['usage', 'pushToken'].includes(key)) return await store.get(key, fallback);
      if (key === 'settings') {
        const global = await store.get('settings', {
          notifications: false,
          importantOnly: true,
          analysisConsent: false
        });
        const local = await store.get(`account:${id}:preferences`, {
          notifications: true,
          importantOnly: true
        });
        return {
          ...global,
          notifications: global.notifications && local.notifications,
          importantOnly: local.importantOnly
        };
      }
      return await store.get(`account:${id}:${key}`, fallback);
    },
    async set(key, value) {
      if (key === 'email') {
        await store.set('accounts', (await accounts(store)).map(a => a.id === id ? {
          ...a,
          email: value
        } : a));
        return;
      }
      await store.set(['usage', 'pushToken'].includes(key) ? key : `account:${id}:${key}`, value);
    }
  };
}
export async function migrateAccount(store) {
  if (!(await store.get('google'))) return;
  const id = 'legacy';
  if (!(await accounts(store)).some(a => a.id === id)) {
    for (const key of ['google', 'mails', 'page', 'connectedAt', 'lastSync', 'outbox']) {
      const value = await store.get(key);
      if (value !== null) await accountStore(store, id).set(key, value);
    }
    await accountStore(store, id).set('preferences', {
      notifications: true,
      importantOnly: (await store.get('settings', {})).importantOnly ?? true
    });
    await store.set('accounts', [...(await accounts(store)), {
      id,
      email: null
    }]);
  }
  for (const key of ['google', 'mails', 'page', 'connectedAt', 'lastSync', 'outbox']) await store.delete(key);
  await store.deletePrefix('cache:');
}
export async function linkAccount(store, email, auth) {
  email = email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Invalid Gmail profile');
  const list = await accounts(store);
  const existing = list.find(a => a.email === email);
  const account = existing || {
    id: randomUUID(),
    email
  };
  const scoped = accountStore(store, account.id);
  await scoped.set('google', auth);
  if (!existing) {
    await scoped.set('connectedAt', Date.now());
    await scoped.set('preferences', {
      notifications: true,
      importantOnly: true
    });
    await store.set('accounts', [...list, account]);
  }
  return account;
}
export async function removeAccount(store, id) {
  await store.set('accounts', (await accounts(store)).filter(a => a.id !== id));
  await store.deletePrefix(`account:${id}:`);
}
export async function allMails(store) {
  return (await Promise.all((await accounts(store)).map(async a => (await accountStore(store, a.id).get('mails', [])).map(mail => ({
    ...mail,
    gmailId: mail.id,
    id: `${a.id}:${mail.id}`,
    accountId: a.id,
    accountEmail: a.email
  }))))).flat().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}
