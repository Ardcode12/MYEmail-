import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from './helpers/store.mjs';
import { accounts, accountStore, allMails, linkAccount, migrateAccount, removeAccount } from '../src/accounts.mjs';
import { createService } from '../src/service.mjs';
import { createApi } from '../src/http.mjs';
const env = {
  APP_TOKEN: 'a'.repeat(32),
  PUBLIC_URL: 'http://localhost',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  GEMINI_API_KEY: 'key'
};
const auth = {
  access_token: 'access',
  refresh_token: 'refresh',
  expiresAt: Date.now() + 3600000
};
const summary = {
  summary: 'Review requested',
  category: 'work',
  priority: 'high',
  action: 'Review',
  tokens: 30
};
const mail = {
  id: 'same-gmail-id',
  subject: 'Hi',
  sender: 'Sender',
  body: 'Review',
  receivedAt: new Date().toISOString()
};
async function setup(t) {
  const store = createStore(':memory:', 'aa'.repeat(32));
  t.after(async () => await store.close());
  await store.set('settings', {
    analysisConsent: true,
    notifications: false,
    importantOnly: true
  });
  return store;
}
test('legacy account migration is idempotent and preserves saved inbox state', async t => {
  const store = await setup(t);
  await store.set('google', auth);
  await store.set('mails', [{
    ...mail,
    ...summary,
    read: true,
    archived: true
  }]);
  await store.set('page', 'cursor');
  await migrateAccount(store);
  await migrateAccount(store);
  assert.equal((await accounts(store)).length, 1);
  assert.equal(await store.get('google'), null);
  assert.equal(await accountStore(store, 'legacy').get('page'), 'cursor');
  assert.equal((await allMails(store))[0].read, true);
  assert.equal((await allMails(store))[0].id, 'legacy:same-gmail-id');
});
test('relinking a Gmail identity updates credentials without duplicating or erasing it', async t => {
  const store = await setup(t);
  const first = await linkAccount(store, 'A@gmail.com', auth);
  await accountStore(store, first.id).set('mails', [mail]);
  const second = await linkAccount(store, 'a@gmail.com', {
    ...auth,
    access_token: 'new'
  });
  assert.equal(first.id, second.id);
  assert.equal((await accounts(store)).length, 1);
  assert.equal((await allMails(store)).length, 1);
  assert.equal((await accountStore(store, first.id).get('google')).access_token, 'new');
});
test('mail IDs, cursors, cache and deletion are isolated by account', async t => {
  const store = await setup(t);
  const a = await linkAccount(store, 'a@gmail.com', auth);
  const b = await linkAccount(store, 'b@gmail.com', auth);
  const service = await createService(store, env, {
    getMessages: async scoped => ({
      messages: [mail],
      nextPage: (await scoped.get('page')) === 'next' ? null : 'next'
    }),
    analyze: async () => summary
  });
  await service.sync();
  assert.equal((await allMails(store)).length, 2);
  assert.notEqual((await allMails(store))[0].id, (await allMails(store))[1].id);
  assert.equal(await accountStore(store, a.id).get('page'), 'next');
  assert.equal((await service.status()).usage.calls, 2);
  await accountStore(store, a.id).set('cache:test', summary);
  await accountStore(store, b.id).set('cache:test', summary);
  await removeAccount(store, a.id);
  assert.equal(await accountStore(store, a.id).get('google'), null);
  assert.equal(await accountStore(store, a.id).get('cache:test'), null);
  assert.equal((await allMails(store)).length, 1);
  assert.ok(await accountStore(store, b.id).get('cache:test'));
});
test('one broken account does not prevent another from syncing', async t => {
  const store = await setup(t);
  const a = await linkAccount(store, 'a@gmail.com', {
    ...auth,
    access_token: 'broken'
  });
  await linkAccount(store, 'b@gmail.com', auth);
  const service = await createService(store, env, {
    getMessages: async scoped => {
      if ((await scoped.get('google')).access_token === 'broken') throw new Error('Expired');
      return {
        messages: [mail],
        nextPage: null
      };
    },
    analyze: async () => summary
  });
  const result = await service.sync();
  assert.deepEqual(result.failedAccounts, [a.id]);
  assert.equal(result.added, 1);
  assert.ok((await service.status()).accounts.find(x => x.id === a.id).lastError);
});
test('accounts share one paid request budget and have separate notification preferences', async t => {
  const store = await setup(t);
  const a = await linkAccount(store, 'a@gmail.com', auth);
  const b = await linkAccount(store, 'b@gmail.com', auth);
  const service = await createService(store, {
    ...env,
    DAILY_ANALYSIS_LIMIT: '1'
  }, {
    getMessages: async () => ({
      messages: [mail],
      nextPage: null
    }),
    analyze: async () => summary
  });
  const result = await service.sync();
  assert.equal(result.budgetExhausted, true);
  assert.equal((await service.status()).usage.calls, 1);
  assert.equal((await allMails(store)).length, 1);
  await store.set('settings', {
    notifications: true,
    analysisConsent: true
  });
  await accountStore(store, a.id).set('preferences', {
    notifications: false,
    importantOnly: false
  });
  assert.equal((await accountStore(store, a.id).get('settings')).notifications, false);
  assert.equal((await accountStore(store, b.id).get('settings')).notifications, true);
});
test('OAuth links two identities, deduplicates relinks, and account routes isolate mutations', async t => {
  const store = await setup(t);
  const service = await createService(store, env);
  let email = 'a@gmail.com';
  const revoked = [];
  const server = createApi(store, service, env, {
    exchange: async () => ({
      ...auth,
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly'
    }),
    profile: async () => ({
      emailAddress: email
    }),
    revoke: async token => {
      revoked.push(token);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: `Bearer ${env.APP_TOKEN}`,
    'Content-Type': 'application/json'
  };
  async function connect() {
    const result = await (await fetch(origin + '/auth/google', {
      method: 'POST',
      headers
    })).json();
    const authorization = new URL(result.url);
    assert.match(authorization.searchParams.get('prompt'), /select_account/);
    const callback = await fetch(origin + '/oauth/callback?state=' + authorization.searchParams.get('state') + '&code=code');
    assert.equal(callback.status, 200);
  }
  await connect();
  email = 'b@gmail.com';
  await connect();
  await connect();
  assert.equal((await accounts(store)).length, 2);
  const [a, b] = await accounts(store);
  for (const account of [a, b]) await accountStore(store, account.id).set('mails', [{
    ...mail,
    ...summary,
    read: false,
    archived: false
  }]);
  await fetch(origin + '/mails/' + encodeURIComponent(`${a.id}:${mail.id}`), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      archived: true
    })
  });
  assert.equal((await accountStore(store, a.id).get('mails'))[0].archived, true);
  assert.equal((await accountStore(store, b.id).get('mails'))[0].archived, false);
  assert.equal((await fetch(origin + '/accounts/' + a.id, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      notifications: false
    })
  })).status, 200);
  assert.equal((await fetch(origin + '/accounts/' + a.id, {
    method: 'DELETE',
    headers
  })).status, 200);
  assert.equal((await accounts(store)).length, 1);
  assert.equal((await accounts(store))[0].id, b.id);
  assert.equal(revoked.length, 1);
  const status = await (await fetch(origin + '/status', {
    headers
  })).text();
  assert.ok(!status.includes('access_token'));
  assert.ok(!status.includes('refresh_token'));
});
