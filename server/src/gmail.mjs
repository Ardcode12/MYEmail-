export async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Email service returned ${res.status}`);
  return res.json();
}
export async function exchange(params, env) {
  return jsonFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }) });
}
export function parseMessage(message) {
  const headers = message.payload?.headers || [];
  const header = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const parts = [];
  function walk(part) {
    if (part.filename) return;
    if (part.body?.data && ['text/plain', 'text/html'].includes(part.mimeType)) parts.push({ type: part.mimeType, body: Buffer.from(part.body.data, 'base64url').toString('utf8') });
    for (const child of part.parts || []) walk(child);
  }
  walk(message.payload || {});
  const plain = parts.filter(p => p.type === 'text/plain');
  return { id: message.id, subject: header('Subject') || '(No subject)', sender: header('From'), receivedAt: new Date(Number(message.internalDate)).toISOString(), body: (plain.length ? plain : parts).map(p => p.body).join('\n') || message.snippet || '' };
}
export async function accessToken(store, env) {
  const auth = store.get('google');
  if (!auth) throw new Error('Missing Gmail credentials');
  let token = auth.access_token;
  if (auth.expiresAt < Date.now() + 60000) {
    const next = await exchange({ grant_type: 'refresh_token', refresh_token: auth.refresh_token }, env);
    token = next.access_token; store.set('google', { ...auth, ...next, expiresAt: Date.now() + next.expires_in * 1000 });
  }
  return token;
}
export async function profile(token) {
  return jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
}
export async function getMessages(store, env) {
  const token = await accessToken(store, env);
  const headers = { Authorization: `Bearer ${token}` };
  if (!store.get('profileResolved')) {
    const data = await profile(token); store.set('email', data.emailAddress.toLowerCase()); store.set('profileResolved', true);
  }
  // Persistent page cursor backfills the selected initial window without skipping failed messages.
  const cursor = store.get('page');
  const query = new URLSearchParams({ maxResults: '25', q: env.GMAIL_QUERY || 'in:inbox newer_than:30d' });
  if (cursor) query.set('pageToken', cursor);
  const list = await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers });
  const existing = new Set(store.get('mails', []).map(m => m.id));
  const messages = [];
  for (const item of list.messages || []) {
    if (!existing.has(item.id)) messages.push(parseMessage(await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, { headers })));
  }
  return { messages, nextPage: list.nextPageToken || null };
}
