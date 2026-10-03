import { randomUUID } from 'node:crypto';
export const accounts = store => store.get('accounts', []);
export function accountStore(store, id) {
  return {
    get(key, fallback = null) {
      if (['usage', 'pushToken'].includes(key)) return store.get(key, fallback);
      if (key === 'settings') {
        const global = store.get('settings', { notifications: false, importantOnly: true, analysisConsent: false });
        const local = store.get(`account:${id}:preferences`, { notifications: true, importantOnly: true });
        return { ...global, notifications: global.notifications && local.notifications, importantOnly: local.importantOnly };
      }
      return store.get(`account:${id}:${key}`, fallback);
    },
    set(key, value) { if (key === 'email') { store.set('accounts', accounts(store).map(a => a.id === id ? { ...a, email: value } : a)); return; } store.set(['usage', 'pushToken'].includes(key) ? key : `account:${id}:${key}`, value); }
  };
}
export function migrateAccount(store) {
  if (!store.get('google')) return;
  const id = 'legacy';
  if (!accounts(store).some(a => a.id === id)) {
    for (const key of ['google', 'mails', 'page', 'connectedAt', 'lastSync', 'outbox']) {
      const value = store.get(key); if (value !== null) accountStore(store, id).set(key, value);
    }
    accountStore(store, id).set('preferences', { notifications: true, importantOnly: store.get('settings', {}).importantOnly ?? true });
    store.set('accounts', [...accounts(store), { id, email: null }]);
  }
  for (const key of ['google', 'mails', 'page', 'connectedAt', 'lastSync', 'outbox']) store.delete(key);
  store.deletePrefix('cache:');
}
export function linkAccount(store, email, auth) {
  email = email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Invalid Gmail profile');
  const list = accounts(store);
  const existing = list.find(a => a.email === email);
  const account = existing || { id: randomUUID(), email };
  const scoped = accountStore(store, account.id);
  scoped.set('google', auth);
  if (!existing) {
    scoped.set('connectedAt', Date.now());
    scoped.set('preferences', { notifications: true, importantOnly: true });
    store.set('accounts', [...list, account]);
  }
  return account;
}
export function removeAccount(store, id) {
  store.set('accounts', accounts(store).filter(a => a.id !== id));
  store.deletePrefix(`account:${id}:`);
}
export function allMails(store) {
  return accounts(store).flatMap(a => accountStore(store, a.id).get('mails', []).map(mail => ({ ...mail, gmailId: mail.id, id: `${a.id}:${mail.id}`, accountId: a.id, accountEmail: a.email }))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}
