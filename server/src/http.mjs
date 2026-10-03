import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { accounts, accountStore, allMails, linkAccount, removeAccount } from './accounts.mjs';
import { exchange, profile, accessToken } from './gmail.mjs';
export function createApi(store, service, env, dependencies = {}) {
  const exchangeCode = dependencies.exchange || exchange;
  const getProfile = dependencies.profile || profile;
  const revoke = dependencies.revoke || (async auth => {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        token: auth.refresh_token
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok && response.status !== 400) throw new Error('Revocation failed');
  });
  let accountMutation = false;
  const states = new Map();
  const token = Buffer.from(env.APP_TOKEN || '');
  if (token.length < 32) throw new Error('APP_TOKEN must be at least 32 characters');
  const redirect = `${env.PUBLIC_URL.replace(/\/$/, '')}/oauth/callback`;
  const send = (res, status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 8192) throw new Error('Request too large');
    }
    return text ? JSON.parse(text) : {};
  }
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        await store.ping?.();
        return send(res, 200, {
          ok: true
        });
      }
      if (url.pathname === '/oauth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state');
        const expires = states.get(state);
        states.delete(state);
        if (!expires || expires < Date.now()) return send(res, 400, {
          error: 'Authorization expired. Connect Gmail again from the app.'
        });
        if (service.busy() || accountMutation) return send(res, 409, {
          error: 'Sync in progress. Try connecting again after it finishes.'
        });
        if (url.searchParams.has('error')) return send(res, 400, {
          error: 'Gmail access was not granted. You can retry in the app.'
        });
        const code = url.searchParams.get('code');
        if (!code) return send(res, 400, {
          error: 'Missing authorization code'
        });
        accountMutation = true;
        service.setAccountMutation?.(true);
        try {
          const auth = await exchangeCode({
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirect
          }, env);
          if (!auth.refresh_token || !auth.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) return send(res, 400, {
            error: 'Read-only Gmail access and offline access are required. Reconnect and grant access.'
          });
          const identity = await getProfile(auth.access_token);
          for (const a of (await accounts(store)).filter(a => !a.email)) {
            const scoped = accountStore(store, a.id);
            const oldIdentity = await getProfile(await accessToken(scoped, env));
            await scoped.set('email', oldIdentity.emailAddress.toLowerCase());
          }
          await linkAccount(store, identity.emailAddress, {
            ...auth,
            expiresAt: Date.now() + auth.expires_in * 1000
          });
        } finally {
          accountMutation = false;
          service.setAccountMutation?.(false);
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
        });
        return res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:system-ui;padding:48px;background:#101a30;color:#fff"><h1>Gmail is connected.</h1><p>Return to Briefmail and tap Sync inbox.</p></body></html>');
      }
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) return send(res, 401, {
        error: 'Invalid server access token'
      });
      if (url.pathname === '/status' && req.method === 'GET') return send(res, 200, await service.status());
      if (url.pathname === '/mails' && req.method === 'GET') return send(res, 200, await allMails(store));
      if (url.pathname === '/auth/google' && req.method === 'POST') {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return send(res, 400, {
          error: 'Configure Google OAuth credentials on the server first'
        });
        for (const [key, expires] of states) if (expires < Date.now()) states.delete(key);
        if (states.size >= 5) return send(res, 429, {
          error: 'Too many pending sign-ins. Wait five minutes.'
        });
        const state = randomBytes(32).toString('hex');
        states.set(state, Date.now() + 300000);
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: redirect,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          access_type: 'offline',
          prompt: 'consent select_account',
          state
        });
        return send(res, 200, {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`
        });
      }
      if (url.pathname === '/sync' && req.method === 'POST') {
        if (accountMutation) return send(res, 409, {
          error: 'Account connection is changing. Retry shortly.'
        });
        return send(res, 200, await service.sync());
      }
      if (url.pathname === '/settings' && req.method === 'PATCH') {
        if (service.busy() || accountMutation) return send(res, 409, {
          error: 'Wait for the current sync to finish before changing settings'
        });
        const input = await body(req);
        const prefs = await service.settings();
        for (const key of ['notifications', 'importantOnly', 'analysisConsent']) if (key in input) {
          if (typeof input[key] !== 'boolean') return send(res, 400, {
            error: 'Settings must be true or false'
          });
          prefs[key] = input[key];
        }
        await store.set('settings', prefs);
        if (!prefs.notifications) for (const a of await accounts(store)) await accountStore(store, a.id).set('outbox', []);
        return send(res, 200, prefs);
      }
      if (url.pathname === '/device' && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.token !== 'string' || !/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/.test(input.token)) return send(res, 400, {
          error: 'Invalid push token'
        });
        await store.set('pushToken', input.token);
        return send(res, 200, {
          ok: true
        });
      }
      if (url.pathname.startsWith('/mails/') && req.method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.slice(7));
        const input = await body(req);
        const mails = await allMails(store);
        const mail = mails.find(m => m.id === id);
        if (!mail) return send(res, 404, {
          error: 'Message not found'
        });
        for (const key of ['read', 'archived']) if (key in input) {
          if (typeof input[key] !== 'boolean') return send(res, 400, {
            error: 'Invalid message update'
          });
          mail[key] = input[key];
        }
        const scoped = accountStore(store, mail.accountId);
        await scoped.set('mails', (await scoped.get('mails', [])).map(m => m.id === mail.gmailId ? {
          ...m,
          read: mail.read,
          archived: mail.archived
        } : m));
        return send(res, 200, mail);
      }
      if (url.pathname.startsWith('/accounts/')) {
        const id = decodeURIComponent(url.pathname.slice('/accounts/'.length));
        const account = (await accounts(store)).find(a => a.id === id);
        if (!account) return send(res, 404, {
          error: 'Account not found'
        });
        if (service.busy() || accountMutation) return send(res, 409, {
          error: 'Wait for the current sync or account change to finish'
        });
        const scoped = accountStore(store, id);
        if (req.method === 'PATCH') {
          const input = await body(req);
          const prefs = await scoped.get('preferences', {
            notifications: true,
            importantOnly: true
          });
          for (const key of ['notifications', 'importantOnly']) if (key in input) {
            if (typeof input[key] !== 'boolean') return send(res, 400, {
              error: 'Settings must be true or false'
            });
            prefs[key] = input[key];
          }
          await scoped.set('preferences', prefs);
          if (!prefs.notifications) await scoped.set('outbox', []);
          return send(res, 200, prefs);
        }
        if (req.method === 'DELETE') {
          accountMutation = true;
          service.setAccountMutation?.(true);
          try {
            await revoke(await scoped.get('google'));
            await removeAccount(store, id);
            states.clear();
          } finally {
            accountMutation = false;
            service.setAccountMutation?.(false);
          }
          return send(res, 200, {
            ok: true
          });
        }
      }
      if (url.pathname === '/account' && req.method === 'DELETE') {
        if (service.busy() || accountMutation) return send(res, 409, {
          error: 'Wait for the current sync or account change to finish'
        });
        accountMutation = true;
        service.setAccountMutation?.(true);
        try {
          for (const a of await accounts(store)) {
            await revoke(await accountStore(store, a.id).get('google'));
            await removeAccount(store, a.id);
          }
          await store.clear();
          states.clear();
        } finally {
          accountMutation = false;
          service.setAccountMutation?.(false);
        }
        return send(res, 200, {
          ok: true
        });
      }
      send(res, 404, {
        error: 'Route not found'
      });
    } catch (error) {
      console.error('API / OAuth error:', error);
      const safe = ['Connect Gmail first', 'Enable email analysis in settings first', 'Set GEMINI_API_KEY on the server'];
      send(res, safe.includes(error.message) ? 400 : 503, {
        error: error.message || 'Request failed. Check server configuration and try again.'
      });
    }
  };
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && !req.url.startsWith('/oauth/callback') || !store.exclusive) return await handle(req, res);
      await store.exclusive(() => handle(req, res));
    } catch {
      send(res, 503, {
        error: 'Backend storage is busy or unavailable. Try again shortly.'
      });
    }
  });
}
