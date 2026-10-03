export type Mail = { id: string; accountId?: string; accountEmail?: string | null; gmailId?: string; sender: string; subject: string; summary: string; category: 'work' | 'personal' | 'finance' | 'updates'; priority: 'high' | 'normal' | 'low'; action: string; receivedAt: string; read: boolean; archived: boolean; truncated?: boolean };
export type Settings = { notifications: boolean; importantOnly: boolean; analysisConsent: boolean };
export type LinkedAccount = { id: string; email: string | null; settings: { notifications: boolean; importantOnly: boolean }; lastSync?: string | null; lastError?: string | null };
export type ServerStatus = { accounts: LinkedAccount[]; connected: boolean; provider: string; model: string; syncing: boolean; lastSync: string | null; lastError: string | null; usage: { calls: number; tokens: number; cacheHits: number }; dailyLimit: number; settings: Settings };
export type Connection = { url: string; token: string };
