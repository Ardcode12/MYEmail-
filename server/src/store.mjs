import { MongoClient } from 'mongodb';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// Data values retain the original AES-GCM envelope so existing encrypted exports can be imported.
export function createStore(collection, key, options = {}) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  const secret = Buffer.from(key, 'hex');
  const context = new AsyncLocalStorage();
  let localBusy = false;
  function encrypt(value) {
    const plain = JSON.stringify(value);
    if (Buffer.byteLength(plain) > 10 * 1024 * 1024) throw new Error('Saved value exceeds the storage limit');
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const content = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [iv, cipher.getAuthTag(), content].map(v => v.toString('base64')).join('.');
  }
  function decrypt(value) {
    const [iv, tag, content] = value.split('.').map(v => Buffer.from(v, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', secret, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString());
  }
  function checkLease() { if (context.getStore()?.lost) throw new Error('Database write lease lost'); }
  const store = {
    async get(key, fallback = null) {
      const row = await collection.findOne({ _id: key });
      return row ? decrypt(row.value) : fallback;
    },
    async set(key, value) { checkLease(); await collection.updateOne({ _id: key }, { $set: { value: encrypt(value) } }, { upsert: true }); },
    async delete(key) { checkLease(); await collection.deleteOne({ _id: key }); },
    async deletePrefix(prefix) {
      checkLease();
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await collection.deleteMany({ _id: { $regex: `^${escaped}` } });
    },
    async clear() { checkLease(); await collection.deleteMany({}); },
    async ping() { if (options.ping) await options.ping(); },
    async close() { if (options.close) await options.close(); },
    async exclusive(work) {
      if (context.getStore()) { checkLease(); return work(); }
      const busyError = () => Object.assign(new Error('Database is busy. Try again shortly.'), { code: 'STORAGE_BUSY' });
      if (localBusy) throw busyError();
      localBusy = true;
      const owner = randomUUID(); const lease = { lost: false }; let renewal;
      try {
        if (options.locks) {
          try {
            await options.locks.findOneAndUpdate({ _id: 'writer', expiresAt: { $lte: new Date() } }, { $set: { owner, expiresAt: new Date(Date.now() + 90000) } }, { upsert: true });
          } catch (error) { if (error.code === 11000) throw busyError(); throw error; }
          renewal = setInterval(() => {
            options.locks.updateOne({ _id: 'writer', owner }, { $set: { expiresAt: new Date(Date.now() + 90000) } })
              .then(result => { if (result.matchedCount !== 1) lease.lost = true; }).catch(() => { lease.lost = true; });
          }, 20000);
          renewal.unref();
        }
        return await context.run(lease, work);
      } finally {
        clearInterval(renewal);
        if (options.locks) await options.locks.deleteOne({ _id: 'writer', owner }).catch(() => {});
        localBusy = false;
      }
    }
  };
  return store;
}

export async function connectStore(env) {
  if (!env.MONGODB_URI || !/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) throw new Error('Set MONGODB_URI to your Atlas connection string');
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || '')) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  const database = env.MONGODB_DB || 'briefmail';
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error('MONGODB_DB must contain only letters, numbers, underscores, or hyphens');
  let client;
  try {
    client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 5, minPoolSize: 0, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 10000, waitQueueTimeoutMS: 10000, timeoutMS: 15000 });
    await client.connect();
    const db = client.db(database);
    await db.command({ ping: 1 });
    const store = createStore(db.collection('encrypted_values'), env.ENCRYPTION_KEY, {
      locks: db.collection('operation_locks'), ping: () => db.command({ ping: 1 }), close: () => client.close()
    });
    // Fail startup rather than silently overwriting a database encrypted with another key.
    await store.exclusive(async () => {
      const marker = await store.get('_encryption_check');
      if (marker && marker !== 'briefmail-v1') throw new Error('Invalid encryption marker');
      if (!marker) await store.set('_encryption_check', 'briefmail-v1');
    });
    return store;
  } catch {
    await client?.close().catch(() => {});
    throw new Error('Atlas connection failed. Check MONGODB_URI, database permissions, Network Access, and ENCRYPTION_KEY.');
  }
}
