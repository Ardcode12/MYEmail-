import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync } from 'node:fs';
export function createStore(path, key) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  if (path !== ':memory:') mkdirSync(new URL('../data/', import.meta.url), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const secret = Buffer.from(key, 'hex');
  return {
    get(k, fallback = null) {
      const row = db.prepare('SELECT value FROM kv WHERE key=?').get(k);
      if (!row) return fallback;
      const [iv, tag, content] = row.value.split('.').map(v => Buffer.from(v, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', secret, iv); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString());
    },
    set(k, value) {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      db.prepare('INSERT OR REPLACE INTO kv VALUES (?, ?)').run(k, [iv, cipher.getAuthTag(), content].map(v => v.toString('base64')).join('.'));
    },
    delete(key) { db.prepare('DELETE FROM kv WHERE key=?').run(key); },
    deletePrefix(prefix) { db.prepare('DELETE FROM kv WHERE substr(key,1,?)=?').run(prefix.length, prefix); },
    clear() { db.exec('DELETE FROM kv; VACUUM;'); }, close() { db.close(); }
  };
}
