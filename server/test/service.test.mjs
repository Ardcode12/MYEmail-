import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { createSingleService as createService } from '../src/service.mjs';
const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test', DAILY_ANALYSIS_LIMIT: '2' };
const summary = { summary: 'A summary', category: 'work', priority: 'high', action: 'Review', tokens: 50 };
const mail = id => ({ id, subject: 'Hello', sender: 'Sender', body: 'Body', receivedAt: new Date().toISOString() });
function setup(t) { const store = createStore(':memory:', 'ab'.repeat(32)); t.after(() => store.close()); store.set('google', { access_token: 'test' }); store.set('settings', { analysisConsent: true, notifications: false, importantOnly: true }); return store; }
test('encrypted store round trips and clears private data', t => { const store = setup(t); store.set('private', { secret: 'value' }); assert.deepEqual(store.get('private'), { secret: 'value' }); store.clear(); assert.equal(store.get('private'), null); });
test('sync is idempotent and caches identical content across message IDs', async t => {
  const store = setup(t); let calls = 0;
  const service = createService(store, env, { getMessages: async () => ({ messages: [mail('1'), mail('2')], nextPage: null }), analyze: async () => { calls++; return summary; } });
  await service.sync(); await service.sync();
  assert.equal(calls, 1); assert.equal(store.get('mails').length, 2); assert.equal(service.status().usage.cacheHits, 1);
  assert.ok(!('body' in store.get('mails')[0]));
});
test('budget exhaustion preserves cursor and does not drop pending messages', async t => {
  const store = setup(t); store.set('page', 'current');
  const service = createService(store, { ...env, DAILY_ANALYSIS_LIMIT: '1' }, { getMessages: async () => ({ messages: [mail('1'), { ...mail('2'), body: 'Different' }], nextPage: 'next' }), analyze: async () => summary });
  const result = await service.sync(); assert.equal(result.budgetExhausted, true); assert.equal(store.get('page'), 'current'); assert.equal(store.get('mails').length, 1);
});
test('failed model calls count toward budget and leave mail retryable', async t => {
  const store = setup(t); const service = createService(store, env, { getMessages: async () => ({ messages: [mail('1')], nextPage: 'next' }), analyze: async () => { throw new Error('Provider unavailable'); } });
  await assert.rejects(service.sync()); assert.equal(service.status().usage.calls, 1); assert.equal(store.get('mails', []).length, 0); assert.equal(store.get('page'), null); assert.equal(service.busy(), false);
});
test('analysis requires explicit consent before fetching email', async t => {
  const store = setup(t); store.set('settings', { analysisConsent: false });
  const service = createService(store, env, { getMessages: async () => { throw new Error('Should never fetch'); } });
  await assert.rejects(service.sync(), /Enable email analysis/);
});
test('concurrent sync requests cannot duplicate paid analysis', async t => {
  const store = setup(t); let resolve; const pending = new Promise(r => { resolve = r; });
  const service = createService(store, env, { getMessages: async () => { await pending; return { messages: [], nextPage: null }; } });
  const first = service.sync(); assert.deepEqual(await service.sync(), { busy: true }); resolve(); await first;
});
test('notification failures retain outbox, retries never expose email text', async t => {
  const store = setup(t); store.set('settings', { analysisConsent: true, notifications: true, importantOnly: true }); store.set('connectedAt', 1); store.set('pushToken', 'ExpoPushToken[test]');
  let fail = true; let sends = 0;
  const service = createService(store, env, { getMessages: async () => ({ messages: [mail('1')], nextPage: null }), analyze: async () => summary,
    fetch: async (_url, options) => { sends++; const body = JSON.parse(options.body); assert.ok(!body.body.includes('A summary')); if (fail) throw new Error('Offline'); return { ok: true, json: async () => ({ data: { status: 'ok', id: 'ticket' } }) }; }
  });
  await assert.rejects(service.sync()); assert.equal(store.get('outbox').length, 1); fail = false; await service.sync(); assert.equal(store.get('outbox').length, 0); assert.equal(sends, 2); assert.equal(store.get('mails').length, 1);
});
