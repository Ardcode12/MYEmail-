import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import Constants from 'expo-constants';
import { api, readConnection, saveConnection, DEFAULT_CONNECTION } from './src/api';
import { demoMails, demoAccounts } from './src/demo';
import type { Connection, Mail, ServerStatus, Settings, LinkedAccount } from './src/types';

const palettes = {
  light: { bg: '#F3F5FA', card: '#FFFFFF', text: '#18243C', muted: '#6F7B91', border: '#E3E8F1', accent: '#5165D9', soft: '#EDF0FF', hero: '#18243C' },
  dark: { bg: '#101727', card: '#1B2539', text: '#F1F4FC', muted: '#A1ADC4', border: '#2C3850', accent: '#A3B0FF', soft: '#293353', hero: '#243251' },
};
const categoryColors = { work: '#6275E5', personal: '#AD71B8', finance: '#398C7A', updates: '#B57D38' };
type IconName = React.ComponentProps<typeof Feather>['name'];
function nameOf(sender: string) { return sender.split('<')[0].trim().replace(/"/g, '') || sender; }
function timeOf(date: string) { return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export default function App() { return <SafeAreaProvider><Inbox /></SafeAreaProvider>; }
function Inbox() {
  const system = useColorScheme();
  const [theme, setTheme] = useState<'light' | 'dark'>(system === 'dark' ? 'dark' : 'light');
  const c = palettes[theme];
  const [fonts, fontError] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold });
  const [tab, setTab] = useState<'Today' | 'Inbox' | 'Settings'>('Today');
  const [connection, setConnection] = useState<Connection | null>(DEFAULT_CONNECTION);
  const [mails, setMails] = useState<Mail[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState<Mail | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_CONNECTION.url);
  const [serverToken, setServerToken] = useState(DEFAULT_CONNECTION.token);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [accountFilter, setAccountFilter] = useState('all');
  const [removeTarget, setRemoveTarget] = useState<LinkedAccount | null>(null);
  const [sampleAccounts, setSampleAccounts] = useState(demoAccounts);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const demo = !connection;
  const linkedAccounts = demo ? sampleAccounts : status?.accounts || [];
  const accountMails = mails.filter(m => accountFilter === 'all' || m.accountId === accountFilter);
  const visible = accountMails.filter(m => !m.archived);
  const priority = visible.filter(m => m.priority === 'high');
  const unread = visible.filter(m => !m.read).length;
  const actions = visible.filter(m => m.action);
  const prefs = status?.settings || { notifications: false, importantOnly: true, analysisConsent: false };
  async function refresh(conn = connection) {
    if (!conn) return;
    const [nextMails, nextStatus] = await Promise.all([api<Mail[]>(conn, '/mails'), api<ServerStatus>(conn, '/status')]);
    setMails(nextMails); setStatus(nextStatus);
    setAccountFilter(current => current === 'all' || nextStatus.accounts.some(a => a.id === current) ? current : 'all');
  }
  useEffect(() => {
    readConnection().then(async saved => {
      const conn = saved || DEFAULT_CONNECTION;
      if (conn) {
        setConnection(conn);
        setServerUrl(conn.url);
        setServerToken(conn.token);
        await refresh(conn);
      }
    }).catch(e => setNotice(e.message));
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active' && connection) refresh().catch(e => setNotice(e.message)); });
    return () => sub.remove();
  }, [connection]);
  useEffect(() => {
    if (!connection || Platform.OS === 'web') return;
    let subscription: { remove(): void } | undefined;
    let cancelled = false;
    import('expo-notifications').then(N => {
      if (cancelled) return;
      N.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
      const openMail = async (id: unknown) => {
        if (typeof id !== 'string') return;
        try {
          const list = await api<Mail[]>(connection, '/mails'); setMails(list);
          const mail = list.find(item => item.id === id); if (mail) { setSelected(mail); setAccountFilter(mail.accountId || 'all'); setTab('Inbox'); }
        } catch (e) { setNotice((e as Error).message); }
      };
      subscription = N.addNotificationResponseReceivedListener(response => { void openMail(response.notification.request.content.data?.mailId); });
      N.getLastNotificationResponseAsync().then(response => { if (response) void openMail(response.notification.request.content.data?.mailId); });
    }).catch(() => setNotice('Push notifications require an Android development or production build.'));
    return () => { cancelled = true; subscription?.remove(); };
  }, [connection]);
  async function run(work: () => Promise<void>) { setBusy(true); setNotice(''); try { await work(); } catch (e) { setNotice((e as Error).message || 'Something went wrong. Try again.'); } finally { setBusy(false); } }
  async function sync() {
    if (!connection) { setNotice('You are exploring sample emails. Connect your server in Settings to sync Gmail.'); return; }
    await run(async () => {
      const result = await api<{ busy?: boolean; budgetExhausted?: boolean; added: number; failedAccounts?: string[] }>(connection, '/sync', 'POST');
      await refresh(); setNotice(result.busy ? 'A sync is already running. Refresh shortly.' : result.failedAccounts?.length ? `${result.added} summaries added. ${result.failedAccounts.length} account(s) could not sync; check Settings.` : result.budgetExhausted ? 'Daily analysis limit reached. Remaining messages will be processed after the UTC reset.' : `${result.added} new ${result.added === 1 ? 'summary' : 'summaries'} added.`);
    });
  }
  async function updateMail(mail: Mail, patch: Partial<Mail>) {
    await run(async () => {
      if (connection) await api(connection, `/mails/${encodeURIComponent(mail.id)}`, 'PATCH', patch);
      setMails(current => current.map(m => m.id === mail.id ? { ...m, ...patch } : m));
      setSelected(current => current?.id === mail.id ? { ...current, ...patch } : current);
      if (patch.archived) setSelected(null);
    });
  }
  async function updateSettings(patch: Partial<Settings>) {
    if (!connection) { setNotice('Connect your server to change email and notification settings.'); return; }
    await run(async () => { await api(connection, '/settings', 'PATCH', patch); await refresh(); });
  }
  async function changeAccount(account: LinkedAccount, patch: Partial<LinkedAccount['settings']>) {
    if (!connection) { setSampleAccounts(current => current.map(a => a.id === account.id ? { ...a, settings: { ...a.settings, ...patch } } : a)); return; }
    await run(async () => { await api(connection, `/accounts/${encodeURIComponent(account.id)}`, 'PATCH', patch); await refresh(); });
  }
  async function enableNotifications(enabled: boolean) {
    if (!enabled) return updateSettings({ notifications: false });
    if (!connection) { setNotice('Connect your server before enabling notifications.'); return; }
    await run(async () => {
      if (Platform.OS === 'web') throw new Error('Enable notifications in the Android app.');
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) throw new Error('Configure your EAS project and Firebase credentials, then install an Android build. See the setup guide.');
      const N = await import('expo-notifications');
      await N.setNotificationChannelAsync('mail', { name: 'Email summaries', importance: N.AndroidImportance.DEFAULT });
      const permission = await N.requestPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Notifications are disabled. Allow them in Android settings to continue.');
      const token = await N.getExpoPushTokenAsync({ projectId });
      await api(connection, '/device', 'POST', { token: token.data });
      await api(connection, '/settings', 'PATCH', { notifications: true }); await refresh();
    });
  }
  const text = (size = 14, weight: 'regular' | 'medium' | 'semibold' | 'bold' = 'regular', color = c.text) => ({ color, fontSize: size, fontFamily: fonts ? ({ regular: 'Poppins_400Regular', medium: 'Poppins_500Medium', semibold: 'Poppins_600SemiBold', bold: 'Poppins_700Bold' })[weight] : undefined });
  function Icon({ name, color = c.muted, size = 20 }: { name: IconName; color?: string; size?: number }) { return <Feather name={name} color={color} size={size} />; }
  function Button({ label, onPress, secondary = false, icon }: { label: string; onPress: () => void; secondary?: boolean; icon?: IconName }) {
    return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={({ pressed }) => [s.button, { backgroundColor: secondary ? c.soft : c.accent, opacity: pressed || busy ? 0.65 : 1 }]}>{icon && <Icon name={icon} color={secondary ? c.accent : theme === 'dark' ? '#101727' : '#FFFFFF'} size={17} />}<Text style={text(13, 'semibold', secondary ? c.accent : theme === 'dark' ? '#101727' : '#FFFFFF')}>{label}</Text></Pressable>;
  }
  function MailCard({ mail }: { mail: Mail }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${nameOf(mail.sender)}. ${mail.subject}. ${mail.priority} priority`} onPress={() => { setSelected(mail); if (!mail.read) void updateMail(mail, { read: true }); }} style={({ pressed }) => [s.mail, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
      <View style={s.row}><View style={[s.avatar, { backgroundColor: categoryColors[mail.category] + '18' }]}><Text style={text(15, 'semibold', categoryColors[mail.category])}>{nameOf(mail.sender).split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text numberOfLines={1} style={text(13, 'semibold')}>{nameOf(mail.sender)}</Text><Text style={text(10, 'regular', c.muted)}>{mail.category.charAt(0).toUpperCase() + mail.category.slice(1)}</Text></View><Text style={text(10, 'regular', c.muted)}>{timeOf(mail.receivedAt)}</Text>{!mail.read && <View style={[s.dot, { backgroundColor: c.accent }]} />}</View>
      <Text numberOfLines={1} style={[text(10, 'regular', c.accent), { marginTop: 10 }]}>{mail.accountEmail || 'Linked Gmail account'}</Text>
      <Text style={[text(16, 'semibold'), { marginTop: 16, marginBottom: 7 }]}>{mail.subject}</Text>
      <Text numberOfLines={3} style={[text(12, 'regular', c.muted), { lineHeight: 21 }]}>{mail.summary}</Text>
      <View style={[s.row, { marginTop: 16 }]}><View style={[s.tag, { backgroundColor: mail.priority === 'high' ? '#F5A96520' : c.soft }]}><Icon name={mail.priority === 'high' ? 'clock' : 'check-circle'} size={12} color={mail.priority === 'high' ? (theme === 'dark' ? '#F4B978' : '#9A5B20') : c.accent} /><Text style={text(10, 'medium', mail.priority === 'high' ? (theme === 'dark' ? '#F4B978' : '#9A5B20') : c.accent)}>{mail.priority === 'high' ? 'Needs attention' : 'Summarized'}</Text></View><View style={{ flex: 1 }} /><Icon name="arrow-up-right" size={17} /></View>
    </Pressable>;
  }
  function SettingRow({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
    return <View style={[s.settingRow, { borderBottomColor: c.border }]}><View style={{ flex: 1 }}><Text style={text(13, 'medium')}>{title}</Text><Text style={[text(11, 'regular', c.muted), { marginTop: 3, lineHeight: 18 }]}>{detail}</Text></View><Switch accessibilityLabel={title} value={value} disabled={busy} onValueChange={onChange} trackColor={{ false: c.border, true: c.accent }} /></View>;
  }
  if (!fonts && !fontError) return <View style={[s.loading, { backgroundColor: c.bg }]}><ActivityIndicator color={c.accent} /></View>;
  const filtered = accountMails.filter(m => (filter === 'Archived' ? m.archived : !m.archived) && (filter !== 'Unread' || !m.read) && (filter !== 'Important' || m.priority === 'high') && `${m.sender} ${m.subject} ${m.summary}`.toLowerCase().includes(query.toLowerCase()));
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><StatusBar style={theme === 'dark' ? 'light' : 'dark'} /><View style={s.shell}>
    <View style={s.header}><View style={s.row}><View style={[s.logo, { backgroundColor: c.accent }]}><Icon name="mail" color={theme === 'dark' ? '#18243C' : '#FFFFFF'} size={21} /></View><Text style={text(20, 'semibold')}>briefmail<Text style={{ color: c.accent }}>.</Text></Text></View><Pressable accessibilityRole="button" accessibilityLabel="Toggle light and dark theme" onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={[s.iconButton, { backgroundColor: c.card, borderColor: c.border }]}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></Pressable></View>
    {demo && <Pressable accessibilityRole="button" onPress={() => setTab('Settings')} style={[s.demo, { backgroundColor: c.soft }]}><Icon name="eye" size={13} color={c.accent} /><Text style={text(10, 'medium', c.accent)}>Demo inbox · sample emails</Text><View style={{ flex: 1 }} /><Text style={text(10, 'semibold', c.accent)}>Connect yours →</Text></Pressable>}
    {!!notice && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice('')} style={[s.notice, { backgroundColor: c.soft }]}><Text style={[text(12, 'regular'), { flex: 1 }]}>{notice}</Text><Icon name="x" size={16} /></Pressable>}
    {tab !== 'Settings' && linkedAccounts.length > 0 && <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 }}>{[{ id: 'all', email: 'All accounts' }, ...linkedAccounts].map(a => <Pressable accessibilityRole="button" accessibilityLabel={`Show ${a.email || 'existing Gmail account'}`} accessibilityState={{ selected: accountFilter === a.id }} key={a.id} onPress={() => setAccountFilter(a.id)} style={[s.filter, { backgroundColor: accountFilter === a.id ? c.soft : c.card, borderColor: accountFilter === a.id ? c.accent : c.border }]}><Text style={text(10, 'medium', accountFilter === a.id ? c.accent : c.muted)}>{a.email || 'Existing Gmail account'}</Text></Pressable>)}</ScrollView></View>}
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void run(() => refresh())} tintColor={c.accent} />}>
      {tab === 'Today' && <>
        <Text style={text(10, 'medium', c.muted)}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</Text>
        <Text style={[text(30, 'semibold'), { marginTop: 6, letterSpacing: -1 }]}>A little less inbox.</Text><Text style={[text(13, 'regular', c.muted), { marginTop: 3, marginBottom: 24 }]}>A little more room for your day.</Text>
        <View style={[s.hero, { backgroundColor: c.hero }]}><View style={s.row}><View style={s.heroIcon}><Icon name="sun" color="#C4CDFF" size={17} /></View><Text style={text(11, 'medium', '#C4CDFF')}>YOUR INBOX, IN A MINUTE</Text></View><Text style={[text(23, 'semibold', '#FFFFFF'), { lineHeight: 34, marginVertical: 16 }]}>{priority.length ? `${priority.length} things deserve\nyour attention.` : 'You’re all caught up.'}</Text><Text style={[text(12, 'regular', '#BAC5DC'), { lineHeight: 22 }]}>{visible.length ? `${visible.length} emails summarized. ${actions.length} ${actions.length === 1 ? 'message has' : 'messages have'} a next step. Start with what matters below.` : 'Connect Gmail and sync your inbox to get your first briefing.'}</Text><View style={s.heroRule} /><View style={s.row}><Icon name="shield" size={13} color="#BAC5DC" /><Text style={text(10, 'regular', '#BAC5DC')}>{demo ? 'Sample briefing' : `${status?.provider === 'ollama' ? 'On your server' : 'Powered by Gemini'} · Read-only Gmail access`}</Text></View></View>
        <View style={[s.stats, { backgroundColor: c.card, borderColor: c.border }]}>{[[String(unread), 'Unread'], [String(actions.length), 'Next steps'], [String(visible.length), 'Summarized']].map(([value, label], i) => <View key={label} style={[s.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: c.border }]}><Text style={text(23, 'semibold')}>{value}</Text><Text style={text(10, 'regular', c.muted)}>{label}</Text></View>)}</View>
        <View style={s.sectionHeader}><Text style={text(17, 'semibold')}>Needs your attention</Text><Text style={text(11, 'medium', c.accent)}>{priority.length} emails</Text></View>
        {priority.map(mail => <MailCard key={mail.id} mail={mail} />)}
        {!priority.length && <View style={[s.empty, { backgroundColor: c.card }]}><Icon name="check-circle" size={28} color={c.accent} /><Text style={text(14, 'medium')}>Nothing urgent right now</Text><Text style={text(12, 'regular', c.muted)}>Your other summaries are in Inbox.</Text></View>}
        <Button label={busy ? 'Syncing inbox…' : 'Sync inbox'} onPress={() => void sync()} icon="refresh-cw" secondary />
      </>}
      {tab === 'Inbox' && <>
        <Text style={text(28, 'semibold')}>Your inbox, simplified.</Text><Text style={[text(12, 'regular', c.muted), { marginVertical: 8 }]}>The essentials from every email.</Text>
        <View style={[s.search, { backgroundColor: c.card, borderColor: c.border }]}><Icon name="search" size={18} /><TextInput accessibilityLabel="Search emails" placeholder="Search sender, subject, or summary" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} style={[text(12), { flex: 1, paddingVertical: 12 }]} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 18 }}>{['All', 'Unread', 'Important', 'Archived'].map(item => <Pressable accessibilityRole="button" accessibilityState={{ selected: filter === item }} key={item} onPress={() => setFilter(item)} style={[s.filter, { backgroundColor: filter === item ? c.accent : c.card, borderColor: c.border }]}><Text style={text(11, 'medium', filter === item ? theme === 'dark' ? '#101727' : '#FFFFFF' : c.muted)}>{item}</Text></Pressable>)}</ScrollView>
        {filtered.map(mail => <MailCard key={mail.id} mail={mail} />)}
        {!filtered.length && <View style={[s.empty, { backgroundColor: c.card }]}><Icon name="inbox" size={30} /><Text style={text(15, 'medium')}>No emails here yet</Text><Text style={text(12, 'regular', c.muted)}>{query ? 'Try a different search.' : 'Sync your inbox or choose another filter.'}</Text></View>}
        <Button label="Sync inbox" onPress={() => void sync()} icon="refresh-cw" secondary />
      </>}
      {tab === 'Settings' && <>
        <Text style={text(28, 'semibold')}>Make room for you.</Text><Text style={[text(12, 'regular', c.muted), { marginTop: 6, marginBottom: 24 }]}>Your inbox. Your preferences.</Text>
        <Text style={[text(12, 'semibold'), { marginBottom: 12 }]}>YOUR CONNECTION</Text>
        <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={s.row}><Icon name="mail" color={c.accent} /><Text style={text(14, 'semibold')}>Gmail Account</Text></View>
          <Text style={[text(11, 'regular', c.muted), { lineHeight: 19, marginVertical: 12 }]}>{linkedAccounts.length ? `${linkedAccounts.length} account(s) connected to Briefmail.` : 'Connect your Gmail to begin receiving AI summaries and briefings.'}</Text>
          <Button label={linkedAccounts.length ? 'Add another Gmail account' : 'Connect Gmail'} onPress={() => void run(async () => {
            const conn = connection || DEFAULT_CONNECTION;
            if (!prefs.analysisConsent) {
              await updateSettings({ analysisConsent: true });
            }
            const result = await api<{ url: string }>(conn, '/auth/google', 'POST');
            await Linking.openURL(result.url);
          })} icon="mail" />
          <View style={{ marginTop: 12 }}><Button label="Refresh connection" secondary onPress={() => void run(() => refresh())} /></View>
          <Pressable onPress={() => setShowServerConfig(!showServerConfig)} style={{ marginTop: 14, alignItems: 'center' }}>
            <Text style={text(11, 'medium', c.muted)}>{showServerConfig ? 'Hide custom server ▲' : 'Custom server settings ▼'}</Text>
          </Pressable>
          {showServerConfig && <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 12 }}>
            <Text style={[text(10, 'regular', c.muted), { marginBottom: 8 }]}>Backend: {connection?.url || DEFAULT_CONNECTION.url}</Text>
            <Text style={text(11, 'medium')}>Server URL</Text>
            <TextInput accessibilityLabel="Server URL" autoCapitalize="none" keyboardType="url" value={serverUrl} onChangeText={setServerUrl} style={[s.input, text(12), { borderColor: c.border }]} />
            <Text style={text(11, 'medium')}>Server access token</Text>
            <TextInput accessibilityLabel="Server access token" autoCapitalize="none" secureTextEntry value={serverToken} onChangeText={setServerToken} style={[s.input, text(12), { borderColor: c.border }]} />
            <Button label="Save server" secondary onPress={() => void run(async () => {
              const url = serverUrl.trim().replace(/\/$/, '');
              const conn = { url, token: serverToken.trim() };
              await refresh(conn);
              await saveConnection(conn);
              setConnection(conn);
              setNotice('Server updated.');
            })} />
          </View>}
        </View>
        <Text style={[text(12, 'semibold'), { marginBottom: 12 }]}>LINKED GMAIL ACCOUNTS{demo ? ' · DEMO' : ''}</Text>
        {linkedAccounts.map(account => <View key={account.id} style={[s.panel, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={s.row}><Icon name="mail" color={c.accent} /><Text style={[text(13, 'semibold'), { flex: 1 }]}>{account.email || 'Existing Gmail account'}</Text></View>
          <Text style={[text(10, 'regular', c.muted), { marginTop: 8 }]}>{account.lastError || (account.lastSync ? `Last synced ${new Date(account.lastSync).toLocaleString()}` : demo ? 'Sample linked account' : 'Ready to sync')}</Text>
          <SettingRow title="Notifications for this account" detail="Requires email notifications to be enabled below." value={account.settings.notifications} onChange={value => void changeAccount(account, { notifications: value })} />
          <SettingRow title="Important emails only" detail="Choose which messages trigger an alert for this account." value={account.settings.importantOnly} onChange={value => void changeAccount(account, { importantOnly: value })} />
          {!demo && <View style={{ marginTop: 12 }}><Button label="Disconnect this account" secondary onPress={() => setRemoveTarget(account)} /></View>}
        </View>)}
        <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border }]}>
          <SettingRow title="Dark appearance" detail="A softer inbox after hours." value={theme === 'dark'} onChange={value => setTheme(value ? 'dark' : 'light')} />
          <SettingRow title="Allow email analysis" detail={status?.provider === 'ollama' ? 'Send email text to the Ollama model on your server.' : 'Send email text to Google Gemini to generate summaries. Attachments are excluded.'} value={prefs.analysisConsent} onChange={value => void updateSettings({ analysisConsent: value })} />
          <SettingRow title="Email notifications" detail="Private alerts with no email text on your lock screen." value={prefs.notifications} onChange={value => void enableNotifications(value)} />

        </View>
        <View style={[s.panel, { backgroundColor: c.soft, borderColor: c.border }]}><View style={s.row}><Icon name="zap" color={c.accent} /><Text style={text(13, 'semibold')}>A lighter way to summarize</Text></View><Text style={[text(11, 'regular', c.muted), { lineHeight: 20, marginTop: 12 }]}>Each email is analyzed once. Saved summaries power your briefing without another AI request. All accounts share one daily request limit.</Text><Text style={[text(12, 'medium'), { marginTop: 14 }]}>{status ? `${status.usage.calls} / ${status.dailyLimit} daily requests · ${status.usage.tokens.toLocaleString()} reported tokens` : 'Connect a server to see actual usage.'}</Text>{status && <Text style={[text(10, 'regular', c.muted), { marginTop: 5 }]}>{status.provider} / {status.model} · Resets at 00:00 UTC</Text>}</View>
        {status?.lastError && <Text style={[text(12, 'regular', '#BB6544'), { marginBottom: 16 }]}>Last sync: {status.lastError}</Text>}
        {connection && <><Button label="Sync inbox" icon="refresh-cw" onPress={() => void sync()} /><View style={{ height: 12 }} /><Button label="Disconnect and delete saved data" secondary onPress={() => setConfirmDisconnect(true)} /></>}
        <Text style={[text(10, 'regular', c.muted), { textAlign: 'center', lineHeight: 19, marginTop: 24 }]}>Briefmail · Your daily breathing room.{ '\n' }AI summaries can miss context. Check the original for important details.</Text>
      </>}
    </ScrollView>
    <View style={[s.nav, { backgroundColor: c.card, borderTopColor: c.border }]}>{(['Today', 'Inbox', 'Settings'] as const).map((item, i) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === item }} key={item} onPress={() => setTab(item)} style={s.navItem}><View style={[s.navIcon, { backgroundColor: tab === item ? c.soft : 'transparent' }]}><Icon name={(['sun', 'inbox', 'sliders'] as IconName[])[i]} color={tab === item ? c.accent : c.muted} /></View><Text style={text(10, tab === item ? 'semibold' : 'regular', tab === item ? c.accent : c.muted)}>{item}</Text></Pressable>)}</View>
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}><SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><ScrollView contentContainerStyle={[s.content, { maxWidth: 620, width: '100%', alignSelf: 'center' }]}>{selected && <><Pressable accessibilityRole="button" accessibilityLabel="Close email" onPress={() => setSelected(null)} style={s.close}><Icon name="arrow-left" /><Text style={text(13, 'medium')}>Back to inbox</Text></Pressable><Text style={[text(26, 'semibold'), { marginTop: 26 }]}>{selected.subject}</Text><Text style={[text(12, 'regular', c.muted), { marginVertical: 14 }]}>{selected.sender}{'\n'}To: {selected.accountEmail || 'Linked Gmail account'}{'\n'}{new Date(selected.receivedAt).toLocaleString()}</Text><View style={[s.panel, { backgroundColor: c.card, borderColor: c.border }]}><Text style={text(11, 'semibold', c.accent)}>THE SHORT VERSION</Text><Text style={[text(16), { lineHeight: 29, marginTop: 14 }]}>{selected.summary}</Text>{selected.truncated && <Text style={[text(11, 'regular', c.muted), { marginTop: 12 }]}>This summary covers the first part of a long email.</Text>}</View>{!!selected.action && <View style={[s.panel, { backgroundColor: c.soft, borderColor: c.border }]}><Text style={text(11, 'semibold', c.accent)}>YOUR NEXT STEP</Text><Text style={[text(14), { lineHeight: 25, marginTop: 10 }]}>{selected.action}</Text></View>}<Button label={demo ? 'Original unavailable in demo' : 'Open original in Gmail'} secondary icon="external-link" onPress={() => { if (demo) Alert.alert('Sample email', 'Connect Gmail to open real emails.'); else void run(async () => { await Linking.openURL(`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(selected.accountEmail || '')}#all/${encodeURIComponent(selected.gmailId || selected.id)}`); }); }} /><View style={{ height: 12 }} /><Button label={selected.archived ? 'Restore to Briefmail inbox' : 'Archive in Briefmail'} icon="archive" onPress={() => void updateMail(selected, { archived: !selected.archived })} /><Text style={[text(10, 'regular', c.muted), { marginTop: 16, textAlign: 'center' }]}>Read and archive changes apply inside Briefmail only.</Text></>}</ScrollView></SafeAreaView></Modal>
    <Modal visible={!!removeTarget} transparent animationType="fade" onRequestClose={() => setRemoveTarget(null)}><View style={s.overlay}><View style={[s.confirm, { backgroundColor: c.card }]}><Text style={text(20, 'semibold')}>Disconnect this account?</Text><Text style={[text(13, 'regular', c.muted), { lineHeight: 23, marginVertical: 18 }]}>{removeTarget?.email || 'This Gmail account'} will be disconnected and its saved summaries deleted. Other linked accounts will stay connected. Original Gmail messages are unchanged.</Text><Button label="Disconnect account" onPress={() => void run(async () => { if (!connection || !removeTarget) return; await api(connection, `/accounts/${encodeURIComponent(removeTarget.id)}`, 'DELETE'); setRemoveTarget(null); await refresh(); setNotice('Account disconnected. Your other accounts are still linked.'); })} /><View style={{ height: 12 }} /><Button label="Keep this account" secondary onPress={() => setRemoveTarget(null)} /></View></View></Modal>
    <Modal visible={confirmDisconnect} transparent animationType="fade" onRequestClose={() => setConfirmDisconnect(false)}><View style={s.overlay}><View style={[s.confirm, { backgroundColor: c.card }]}><Text style={text(20, 'semibold')}>Disconnect all accounts?</Text><Text style={[text(13, 'regular', c.muted), { lineHeight: 23, marginVertical: 18 }]}>This revokes access to all linked Gmail accounts and deletes all summaries, credentials, and settings from your server. Your Gmail messages stay in Gmail.</Text><Button label="Delete saved data and disconnect" onPress={() => void run(async () => { if (connection) await api(connection, '/account', 'DELETE'); await saveConnection(null); setConnection(null); setStatus(null); setMails(demoMails); setSampleAccounts(demoAccounts); setAccountFilter('all'); setConfirmDisconnect(false); setNotice('Disconnected. Saved server data has been deleted.'); })} /><View style={{ height: 12 }} /><Button label="Keep my connection" secondary onPress={() => setConfirmDisconnect(false)} /></View></View></Modal>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, shell: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center' },
  header: { paddingHorizontal: 24, paddingVertical: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logo: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, iconButton: { height: 44, width: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  demo: { marginHorizontal: 24, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, flexDirection: 'row', gap: 7, alignItems: 'center' }, notice: { margin: 16, padding: 14, borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }, content: { padding: 24, paddingBottom: 36 },
  hero: { padding: 24, borderRadius: 22 }, heroIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFFFFF12', alignItems: 'center', justifyContent: 'center' }, heroRule: { height: 1, backgroundColor: '#FFFFFF20', marginVertical: 18 },
  stats: { flexDirection: 'row', borderRadius: 17, borderWidth: 1, marginTop: 16, paddingVertical: 18 }, stat: { flex: 1, alignItems: 'center', gap: 2 }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 16 },
  mail: { padding: 20, borderRadius: 18, borderWidth: 1, marginBottom: 14 }, avatar: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, dot: { width: 6, height: 6, borderRadius: 3 }, tag: { flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  button: { minHeight: 48, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 14, borderRadius: 13, marginTop: 16 }, filter: { paddingVertical: 11, paddingHorizontal: 17, borderRadius: 22, borderWidth: 1 }, empty: { padding: 28, gap: 14, alignItems: 'center', borderRadius: 16, marginBottom: 18 },
  panel: { padding: 20, borderRadius: 17, borderWidth: 1, marginBottom: 18 }, input: { borderWidth: 1, borderRadius: 9, padding: 12, minHeight: 48, marginTop: 6, marginBottom: 16 }, settingRow: { paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, paddingBottom: 9 }, navItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 55 }, navIcon: { paddingVertical: 6, paddingHorizontal: 22, borderRadius: 14 }, close: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, overlay: { flex: 1, backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center', padding: 24 }, confirm: { padding: 24, borderRadius: 20, width: '100%', maxWidth: 440 },
});
