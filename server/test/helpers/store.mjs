import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { createStore as encryptedStore } from '../../src/store.mjs';
export function createStore(_path, key) {
  if (process.env.TEST_MONGODB_URI) {
    const client = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    const db = client.db('briefmail_test_' + randomUUID().replaceAll('-', ''));
    return encryptedStore(db.collection('encrypted_values'), key, { close: async () => { await db.dropDatabase(); await client.close(); } });
  }
  const rows = new Map();
  return encryptedStore({
    async findOne({ _id }) { return rows.get(_id) || null; },
    async updateOne({ _id }, update) { rows.set(_id, { _id, ...structuredClone(update.$set) }); },
    async deleteOne({ _id }) { rows.delete(_id); },
    async deleteMany(filter) {
      for (const key of rows.keys()) if (!filter._id || new RegExp(filter._id.$regex).test(key)) rows.delete(key);
    }
  }, key);
}
