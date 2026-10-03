# Briefmail

An Android email assistant built with React Native / Expo and a Node.js 24 backend. Gmail connects with read-only OAuth. Gemini generates concise summaries, categories, priorities, and next steps; Ollama is an alternate provider. Poppins typography, light and dark themes, and a clearly marked sample inbox are included.

This is a **single-user, self-hosted MVP**, not a multi-user hosted service. The code is implemented; live Gmail, AI calls, and Android push need your credentials and a configured device build. No credentials are embedded in the app.

## Start the app

```bash
npm install
npm run mobile
```

The sample inbox works without a backend. For a browser UI preview:

```bash
npm run web --workspace apps/mobile
```

Browser preview is for the UI. Native push and persistent secure credentials are Android features. The server deliberately does not enable cross-origin browser access.

## Start the backend

Requires Node.js 24 or newer, including its built-in SQLite support. No third-party server runtime packages are required.

```bash
cp server/.env.example server/.env
openssl rand -hex 32
openssl rand -hex 32
```

Put the two separate random values in `APP_TOKEN` and `ENCRYPTION_KEY`. Fill the Google OAuth credentials and Gemini API key in `server/.env`, then:

```bash
npm run server
```

Keep the server running for background sync and notifications. The default bind address is loopback; deploy behind an HTTPS reverse proxy. Set `PUBLIC_URL` to the public HTTPS origin. Never put the Gemini key or Google client secret in the mobile app. Enter the HTTPS origin and `APP_TOKEN` in the app's Settings, enable analysis consent, and connect Gmail.

Read [SETUP.md](docs/SETUP.md) for Google OAuth, Gemini/Ollama, Android push credentials, APK builds, and deployment. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for cost controls, data handling, and known limitations.

## Included

- Today briefing derived from saved summaries, without an extra model request.
- Search by sender, subject, and summary; unread, important, and archived filters.
- Email detail, extracted next step, original Gmail link, local read/archive controls.
- Server pairing with Android SecureStore and explicit email-analysis consent.
- Multiple linked Gmail accounts, combined inbox and account filters, per-account notifications and disconnect.
- Gmail OAuth with one-time expiring state, offline refresh, bounded paginated sync.
- Gemini and Ollama adapters with structured output and runtime validation.
- Encrypted SQLite values for credentials, metadata, summaries, and settings.
- Persistent cache, per-day request limits, bounded inputs/outputs, sync locking.
- Server polling and private Expo push alerts with retryable notification outbox.
- Individual-account or all-account disconnect, Google token revocation, and saved-data deletion.

## Checks

```bash
npm test
npm run typecheck
cd apps/mobile
npx expo export --platform android
```

Backend tests use fake email/model/push services and a temporary localhost HTTP server. They do not access Gmail or spend AI credits. `expo export` validates JavaScript bundling; it does not build or test a native APK.
# MYEmail-
