# Setup and deployment

## 1. Google Gmail access

1. Create a Google Cloud project and enable Gmail API.
2. Configure an OAuth consent screen, add your Gmail address as a test user during development, and request `https://www.googleapis.com/auth/gmail.readonly`.
3. Create an OAuth **Web application** client. The backend handles the code exchange; this is not an Android OAuth client flow.
4. Register exactly `https://YOUR-SERVER/oauth/callback` as an authorized redirect URI. For local desktop development Google also supports `http://localhost:8787/oauth/callback`; that address does not refer to your computer when opened on a phone.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_URL` in `server/.env`. Keep the secret on the server.
6. In the app: connect server → allow email analysis → connect Gmail → grant read-only access → return to app → refresh connection → sync inbox.

The Gmail scope is restricted. Public distribution requires meeting Google's OAuth verification and applicable data handling requirements. Review [Google's scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes) before launching a public service. Development/test credentials can expire or be revoked; reconnect when necessary.

## 2. Gemini

Set:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-2.5-flash-lite
DAILY_ANALYSIS_LIMIT=100
```

The model is configurable. Check availability in your Google project and change the ID if needed. The default is a compact summarization-oriented starting point, not a claim that it is the cheapest option for every workload. Enable billing limits/alerts in the provider account as appropriate. The app's daily cap counts requests, not currency, and includes failed requests conservatively.

The server uses Gemini's REST API with JSON Schema output: [structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output). No training or fine-tuning is needed for this version.

## 3. Ollama alternative

Install Ollama on your server and pull a model appropriate to the machine, for example:

```bash
ollama pull qwen3:8b
```

Then configure and restart the backend:

```dotenv
AI_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

Keep Ollama private to your server/network. Memory needs and latency depend on model size, quantization, context, and hardware; measure on your machine before choosing. This adapter uses [Ollama's chat API](https://docs.ollama.com/api/chat) with structured output. Switching providers affects newly analyzed messages; existing summaries remain saved.

## 4. Real Android notifications and APK

The demo UI does not require push credentials. Real remote notifications require a configured Android build, not Android Expo Go.

1. Create/sign into an Expo account and run `npx eas-cli login` and `npx eas-cli init` from `apps/mobile` to associate the app with your EAS project. This writes the project ID used by the push registration code.
2. Create a Firebase project and register Android package `com.briefmail.app` (or change the package consistently before your first release).
3. Download `google-services.json` to `apps/mobile` and add `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json`.
4. Upload the Firebase service account credential to EAS using `npx eas-cli credentials`, following [Expo's FCM v1 setup guide](https://docs.expo.dev/push-notifications/fcm-credentials/). Keep service-account private keys outside this repository.
5. Run `npx eas-cli build --platform android --profile development` to produce an internal APK. Build operations may consume EAS quota. The profile creates an installable APK, not a custom development client.
6. Install on a physical Android phone. Pair with your HTTPS server, connect Gmail, sync, then enable notifications and allow the Android notification permission.
7. Send a new test email from another account after connection. With “Important emails only” enabled for that linked account, it must be classified high priority to notify; disable that setting when testing generic delivery.

Polling defaults to two minutes. Processing backlogs, provider errors, daily limits, device connectivity, and Android delivery policies can delay alerts. Historical mail is summarized without a notification flood. Lock-screen messages do not contain sender names or summaries. Tapping an alert opens its saved summary.

For a Play Store artifact, use `npx eas-cli build --platform android --profile production`. Store signing, privacy disclosures, OAuth verification, and device testing remain release tasks.

## 5. Hosting

Run one Node process per database. Place the API behind an HTTPS reverse proxy, allow only the intended public routes, and apply connection/request rate limits at the proxy. The default server binds `127.0.0.1:8787`. Use a process supervisor for restarts. Keep `server/.env` readable only by the service user.

Back up the encrypted SQLite database and its encryption key separately; losing the key makes saved data unreadable. The key is intentionally not stored in the database. Protect backups and host disks. Disconnect deletes app records, but it cannot erase independent backups or provider-side logs.

For Docker, build at the repository root and pass secrets from your local env file:

```bash
docker build -t briefmail-api -f server/Dockerfile .
docker volume create briefmail-data
docker run --rm --env-file server/.env -e HOST=0.0.0.0 -p 127.0.0.1:8787:8787 -v briefmail-data:/app/server/data briefmail-api
```

Use an HTTPS reverse proxy in front of the mapped loopback port.

## 6. Backfill and operating limits

`GMAIL_QUERY` defaults to `in:inbox newer_than:30d`. Use `in:inbox` for the whole inbox, or `-in:sent -in:drafts` for received mail beyond the inbox (spam/trash are not included by Gmail's default listing). Restart after changing configuration. The server saves 25-message page cursors and repeatedly polls. Large backfills can span days under the daily cap. It does not index attachments.

Development HTTP pairing is limited to localhost/Android emulator origins. Production pairing requires HTTPS. `APP_TOKEN` is an administrator-level bearer credential for this single-user deployment: do not share it between users. A public multi-user product needs per-user identity and tenant isolation before deployment.

## Multiple Gmail accounts

After pairing your server and allowing analysis, use **Settings → Add another Gmail account**. Choose the Gmail identity in Google's account picker and grant read-only access. Return to the app and refresh the connection. Repeating this with an already-linked address refreshes its credentials without creating a duplicate.

Use **All accounts** or an email address above Today/Inbox to filter summaries. Each email is labeled with its receiving account. In Settings, each account has independent notification and important-only controls; the main notifications switch remains the device-wide master switch.

**Disconnect this account** revokes access and deletes only that account's saved summaries, cache, cursor, and credentials. The bottom disconnect-all action removes all linked accounts. Existing single-account installations migrate their saved messages and cursor automatically; the email address appears after a successful profile lookup/sync.

All linked accounts share the configured daily AI request allowance and one registered Android notification device. This is still a personal server, not separate logins for multiple app users.
