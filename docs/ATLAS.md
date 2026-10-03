# Free Atlas storage for Briefmail on Render

Your mobile app continues to use the same backend URL and app token. Only the backend connects to MongoDB.

## 1. Create the Atlas database

1. Sign in to MongoDB Atlas and create a project.
2. Create a **Free / M0** cluster. Do not choose a paid Flex or dedicated tier for this personal testing setup. Pick a nearby region.
3. In Database Access, create a database user with a strong unique password. This is different from your Atlas website login. Give it `readWrite` access to the `briefmail` database.
4. In your Render backend, open **Connect → Outbound**. Copy every outbound IP range listed for that service.
5. Add those ranges in Atlas **Network Access → IP Access List**. For local testing, add your own current public IP too. Your laptop's `192.168...` address is not its public IP. No paid dedicated IP is required: use the ranges Render supplies.
6. In Atlas, choose **Connect → Drivers → Node.js** and copy the `mongodb+srv://...` connection string. Replace its username/password placeholders privately. URL-encode special characters in the username/password, or use a generated password made of URL-safe letters and numbers.

See [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/) and [Render's outbound IP instructions](https://render.com/docs/outbound-ip-addresses).

## 2. Update Render environment variables

Add these in Render → your backend → Environment:

```dotenv
MONGODB_URI=mongodb+srv://DB_USER:ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=briefmail
BACKGROUND_SYNC=false
```

Keep the existing variables, including:

```dotenv
HOST=0.0.0.0
PORT=8787
PUBLIC_URL=https://myemail-backend.onrender.com
APP_TOKEN=YOUR_PRIVATE_APP_TOKEN
ENCRYPTION_KEY=YOUR_STABLE_64_CHARACTER_HEX_KEY
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-2.5-flash-lite
DAILY_ANALYSIS_LIMIT=100
SYNC_INTERVAL_SECONDS=120
GMAIL_QUERY=in:inbox newer_than:30d
```

Use your actual backend URL if it differs. Do not share the URI or secret values in screenshots, chat, or GitHub. Keep the encryption key unchanged once data is saved. Use fresh replacements for previously exposed credentials.

`MONGODB_DB` explicitly selects the database even if the copied connection string contains another database name. The app creates its collections automatically; you do not need to create tables or indexes manually (`_id` is already unique).

## 3. Redeploy the updated code

Push the changed source, `server/package.json`, and **`server/package-lock.json`** to GitHub, excluding `.env`, `node_modules`, and old database files. Render settings:

| Setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime | Docker |
| Root Directory | Blank |
| Dockerfile Path | `server/Dockerfile` |
| Docker Build Context | `.` |
| Docker Command | Blank |
| Health Check Path | `/health` |
| Instance | Free |
| Persistent disk | None |

The Dockerfile installs only the server dependencies. You do not need to install the Android app on Render. For local development run `npm run server:install` once, then `npm run server` with the new Atlas variables in `server/.env`.

Wait for the deployment log to say **Atlas storage connected**. Open your public `/health` URL: a working database connection returns `{"ok":true}`. If startup fails, check the URI, database user permissions, allowed outbound IP ranges, and encryption key. Driver errors and connection strings are deliberately not printed because they may reveal credentials.

## 4. Connect and test

1. In the Android app, enter the existing Render HTTPS URL and matching APP_TOKEN.
2. Enable analysis and reconnect Gmail accounts. The switch from SQLite starts with a new Atlas database; old SQLite records are not uploaded automatically.
3. Tap Sync inbox. Repeat if the Render service is still waking.
4. Restart/redeploy Render, then refresh the app. Accounts and summaries should remain in Atlas.

No mobile code change is required for Atlas. Your Google OAuth callback remains `https://YOUR-SERVICE.onrender.com/oauth/callback`.

## Free-plan behavior

`BACKGROUND_SYNC=false` uses manual sync and avoids periodic model work you did not request. You may set it to `true` to poll while Render is awake, but Atlas does not prevent Render Free from sleeping. Continuous background notifications remain unreliable on that plan. See [Render Free limitations](https://render.com/docs/free).

Atlas Free has storage/throughput limits; see [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Existing AI daily caps limit request counts, not money. Stay within your AI provider's available free quota; no paid plan or billing upgrade is required by this code change.
