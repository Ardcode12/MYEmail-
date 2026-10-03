import { connectStore } from './store.mjs';
import { createService } from './service.mjs';
import { createApi } from './http.mjs';
const env = process.env;
let store;
try {
  if (!env.PUBLIC_URL) throw new Error('PUBLIC_URL is required');
  const intervalSeconds = Number(env.SYNC_INTERVAL_SECONDS || 120);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) throw new Error('SYNC_INTERVAL_SECONDS must be at least 30');
  store = await connectStore(env);
  const service = await store.exclusive(() => createService(store, env));
  const server = createApi(store, service, env);
  server.requestTimeout = 120000;
  server.listen(Number(env.PORT || 8787), env.HOST || '127.0.0.1', () => console.log(`Briefmail API listening on port ${env.PORT || 8787}; Atlas storage connected`));
  let backgroundWork;
  const timer = env.BACKGROUND_SYNC !== 'true' ? null : setInterval(() => {
    if (backgroundWork) return;
    backgroundWork = store.exclusive(async () => {
      if ((await service.status()).connected && (await service.settings()).analysisConsent) await service.sync();
    }).catch(() => console.error('Background sync could not finish; retry from the app.')).finally(() => { backgroundWork = null; });
  }, intervalSeconds * 1000);
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    const timeout = setTimeout(() => process.exit(1), 25000); timeout.unref();
    server.close(async () => { await backgroundWork; await store.close(); clearTimeout(timeout); process.exit(0); });
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  // Connection strings and driver errors may contain credentials. Never log them.
  const safe = ['PUBLIC_URL is required', 'SYNC_INTERVAL_SECONDS must be at least 30', 'APP_TOKEN must be at least 32 characters', 'ENCRYPTION_KEY must be 64 hex characters', 'Set MONGODB_URI to your Atlas connection string'];
  console.error(safe.includes(error.message) ? error.message : 'Backend startup failed. Check Atlas access, database credentials, encryption key, and server configuration.');
  await store?.close(); process.exitCode = 1;
}
