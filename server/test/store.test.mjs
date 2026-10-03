import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { connectStore, createStore } from '../src/store.mjs';
import { createStore as memoryStore } from './helpers/store.mjs';

test('missing Atlas config and malformed encryption keys fail clearly', async () => {
  await assert.rejects(connectStore({}), /MONGODB_URI/);
  assert.throws(() => createStore({}, 'bad'), /ENCRYPTION_KEY/);
});
test('database write failure reaches the caller rather than acknowledging an unsaved value', async () => {
  const store = createStore({ updateOne: async () => { throw new Error('Database offline'); } }, '11'.repeat(32));
  await assert.rejects(store.set('private', { secret: 'private' }), /Database offline/);
});
test('prefix deletion is literal and nested exclusive work does not deadlock', async () => {
  const store = memoryStore(':memory:', '11'.repeat(32));
  await store.set('account:a.b:google', 'remove'); await store.set('account:axb:google', 'keep');
  await store.exclusive(() => store.exclusive(() => store.deletePrefix('account:a.b:')));
  assert.equal(await store.get('account:a.b:google'), null); assert.equal(await store.get('account:axb:google'), 'keep');
  let release;
  const held = store.exclusive(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(store.exclusive(async () => {}), { code: 'STORAGE_BUSY' }); release(); await held;
  await store.close();
});

test('real MongoDB preserves encrypted data across reconnects, rejects wrong keys, and locks writers', { skip: !process.env.TEST_MONGODB_URI }, async t => {
  const env = { MONGODB_URI: process.env.TEST_MONGODB_URI, MONGODB_DB: 'briefmail_test_' + randomUUID().replaceAll('-', ''), ENCRYPTION_KEY: 'ab'.repeat(32) };
  const inspector = new MongoClient(env.MONGODB_URI); await inspector.connect();
  t.after(async () => { await inspector.db(env.MONGODB_DB).dropDatabase(); await inspector.close(); });
  let first = await connectStore(env);
  await first.exclusive(() => first.set('account:a:google', { refresh_token: 'secret-never-plaintext' }));
  const row = await inspector.db(env.MONGODB_DB).collection('encrypted_values').findOne({ _id: 'account:a:google' });
  assert.ok(!JSON.stringify(row).includes('secret-never-plaintext'));
  await first.close();
  first = await connectStore(env); t.after(() => first.close());
  assert.equal((await first.get('account:a:google')).refresh_token, 'secret-never-plaintext');
  await assert.rejects(connectStore({ ...env, ENCRYPTION_KEY: 'cd'.repeat(32) }), /Atlas connection failed/);
  const second = await connectStore(env); t.after(() => second.close());
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const held = first.exclusive(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await ready;
  await assert.rejects(second.exclusive(() => second.set('collision', true)), { code: 'STORAGE_BUSY' });
  release(); await held;
  await second.exclusive(() => second.set('after-release', true));
  assert.equal(await first.get('after-release'), true);
  await first.exclusive(() => first.clear());
  assert.equal(await second.get('account:a:google'), null);
});
