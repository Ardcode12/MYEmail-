import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Connection } from './types';
export const DEFAULT_CONNECTION: Connection = {
  url: 'https://myemail-backend.onrender.com',
  token: '5b7a4298ac1a576ea4bf8b2373eecb80a4db9a7531f866e82618b65938dae87c'
};
export async function readConnection(): Promise<Connection | null> {
  if (Platform.OS === 'web') return DEFAULT_CONNECTION;
  const value = await SecureStore.getItemAsync('briefmail.connection');
  return value ? JSON.parse(value) : DEFAULT_CONNECTION;
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
