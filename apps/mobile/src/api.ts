import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Connection } from './types';
export async function readConnection(): Promise<Connection | null> {
  if (Platform.OS === 'web') return null;
  const value = await SecureStore.getItemAsync('briefmail.connection');
  return value ? JSON.parse(value) : null;
}
export async function saveConnection(connection: Connection | null) {
  // Browser preview intentionally keeps credentials in memory only.
  if (Platform.OS === 'web') return;
  if (connection) await SecureStore.setItemAsync('briefmail.connection', JSON.stringify(connection));
  else await SecureStore.deleteItemAsync('briefmail.connection');
}
export async function api<T>(connection: Connection, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(connection.url.replace(/\/$/, '') + path, { method, headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/sync' ? 120000 : 30000) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Could not reach your server');
  return result;
}
