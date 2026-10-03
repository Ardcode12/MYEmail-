import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createService } from './service.mjs';
import { createApi } from './http.mjs';
const env = process.env;
if (!env.PUBLIC_URL) throw new Error('PUBLIC_URL is required');
const store = createStore(fileURLToPath(new URL('../data/briefmail.sqlite', import.meta.url)), env.ENCRYPTION_KEY || '');
const service = createService(store, env);
const server = createApi(store, service, env);
server.requestTimeout = 120000;
server.listen(Number(env.PORT || 8787), env.HOST || '127.0.0.1', () => console.log(`Briefmail API listening on port ${env.PORT || 8787}`));
const intervalSeconds = Number(env.SYNC_INTERVAL_SECONDS || 120);
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) throw new Error('SYNC_INTERVAL_SECONDS must be at least 30');
const timer = setInterval(() => {
  if (service.status().connected && service.settings().analysisConsent) service.sync().catch(() => console.error('Background sync failed; inspect authenticated /status.'));
}, intervalSeconds * 1000);
function stop() { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
