import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from './helpers/store.mjs';
import { createService } from '../src/service.mjs';
import { createApi } from '../src/http.mjs';
test('API authenticates access, validates settings, and rejects forged OAuth state', async t => {
  const store = createStore(':memory:', '12'.repeat(32));
  const env = {
    APP_TOKEN: 'a'.repeat(32),
    PUBLIC_URL: 'http://localhost',
    GEMINI_API_KEY: 'test'
  };
  const service = await createService(store, env);
  const server = createApi(store, service, env);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await store.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/mails')).status, 401);
  assert.equal((await fetch(url + '/oauth/callback?state=forged&code=bad')).status, 400);
  const headers = {
    Authorization: `Bearer ${env.APP_TOKEN}`,
    'Content-Type': 'application/json'
  };
  assert.equal((await fetch(url + '/status', {
    headers
  })).status, 200);
  assert.equal((await fetch(url + '/settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      notifications: 'yes'
    })
  })).status, 400);
  assert.equal((await fetch(url + '/device', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      token: 'bad-token'
    })
  })).status, 400);
  assert.equal((await fetch(url + '/settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      analysisConsent: true
    })
  })).status, 200);
  assert.equal((await store.get('settings')).analysisConsent, true);
  assert.equal((await fetch(url + '/sync', {
    method: 'POST',
    headers
  })).status, 400);
});
