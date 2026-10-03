# Architecture and decisions

## Flow

```text
Android app (React Native / Expo)
  │ HTTPS + server access token, secured on Android
  ▼
Node.js API ── Gmail OAuth / read-only messages
  │               │
  │               ▼
  │          MIME text extraction
  │               │
  │          trim quoted history + cap text
  │               │
  │          saved result / cache lookup
  │               │
  │          daily request reservation
  │               │
  │          Gemini OR private Ollama
  │               │
  │          validate JSON, save encrypted result
  │               │
  ├── encrypted MongoDB ◄─┘
  └── private Expo push → Android notification → email detail
```

Node is a practical choice for this I/O-heavy service and keeps one language across the project. FastAPI would also work; Python is not necessary merely because an external model is involved. MongoDB Atlas keeps storage independent of the Render filesystem. A multi-user service should use authenticated user sessions, a relational tenant model, a job queue, and isolated worker processing.

## Reducing model usage

- Message IDs avoid re-analyzing saved mail on subsequent syncs.
- Content hashes include normalized input, provider, model, and prompt version. Duplicate content can reuse a saved result.
- Only message subject, sender, and cleaned body go to the model. Attachments are excluded.
- The body is capped at 6,000 characters, subject at 300, sender at 200. Characters are not equivalent to tokens; non-English text can tokenize differently.
- HTML scripts/styles and common quoted reply sections are removed. HTML cleaning is deliberately conservative, not a complete MIME/rendering engine.
- A single structured response supplies summary, category, priority, and action. Output is capped at 300 tokens.
- The Today screen computes counts and next steps from saved results; no second “daily digest” model call.
- Daily request reservations are stored before calling the provider. Failed requests count toward the allowance to prevent uncontrolled retry costs.
- Provider-reported token totals are displayed; they are usage observations, not an invoice or dollar cap.

No artificial percentage savings is claimed. Compare real token usage on a representative mailbox. Aggressive input trimming saves cost but can omit context; the UI marks truncated emails and links to the original. A malformed or blocked model response leaves the message pending instead of inventing a summary.

## Privacy and security

Google access/refresh tokens, saved metadata, summaries, cache entries, device tokens, and settings are encrypted as individual MongoDB document values with AES-256-GCM and random nonces. Raw email bodies are processed in memory and not saved. Model output is treated as plain text, validated, and never executed. Gmail permissions are read-only. Read/archive operations affect Briefmail only.

The model receives untrusted email content with explicit instructions not to follow it. This reduces instruction injection risk; it does not guarantee correct classification. The model has no tools or permissions to act on email. Gemini processing is an external transfer and requires the in-app analysis setting. Ollama processing uses the configured server endpoint. Notification payloads contain only generic copy and a message ID.

The personal server's static bearer token is not a multi-user authentication system. Protect it with HTTPS and secure storage. OAuth states expire in five minutes and are single-use, callback URLs are fixed by configuration, and account changes cannot replace an already-connected account silently.

## Failure handling and remaining limits

- Sync locking prevents concurrent processing in one Node process. The Atlas store adds a database lease around mutations and syncs to protect against overlapping deploys. Keep one service instance for this personal app.
- Page cursors advance only after all fetched messages finish. A failed model request can hold a page until the issue is resolved or the daily limit resets.
- Polling is used instead of Gmail Pub/Sub history synchronization. A large historical backfill can delay new-message processing. A production service should prioritize new arrivals and use history IDs with watch renewal.
- Sync requests can exceed a client's timeout during a large/slow batch. The server continues processing; check status/refresh before retrying.
- First sync is a configurable window. This version does not parse attachment content, send replies, or mirror Gmail read/archive changes.
- Push tickets confirm Expo accepted the request, not device delivery. The outbox retries submission failures; receipt polling and exponential backoff are future improvements. Ambiguous network failures can result in duplicate generic alerts.
- One device push token is stored per personal server. Multi-device routing is not implemented.
- Cached summaries are retained until disconnect. There is no automated retention policy or storage quota yet.
- A server crash after a provider call but before saving its response can cause a repeat analysis on retry. Provider usage dashboards remain the billing source of truth.
- Theme selection follows the system on launch and can be changed for the current session. Browser credentials are memory-only; Android credentials persist in SecureStore.
- Live account/provider integration, notification delivery on a physical device, accessibility with TalkBack, and release signing require environment-specific validation.

## Visual direction

Poppins is used throughout as requested: semibold headlines, medium controls, regular body text. Cool cloud `#F3F5FA`, white `#FFFFFF`, midnight `#18243C`, periwinkle `#5165D9`, muted slate `#6F7B91`, and restrained amber for attention. Dark mode uses `#101727` with raised `#1B2539` surfaces. The signature is an ink-colored inbox briefing card embedded in a calm light interface, mirrored with tonal surfaces in dark mode. The hierarchy centers next steps rather than a wall of email subjects.

## Multiple mailboxes

Each linked Gmail address has its own encrypted storage namespace, OAuth tokens, cursor, summaries, cache, notification preferences, and outbox. Public message IDs combine the internal account ID with the Gmail message ID, avoiding collisions across accounts. Push payloads use that same composite ID. Original-message links select the receiving Gmail address.

The API returns account metadata without tokens. Reauthorizing an existing email updates credentials in place. Existing single-account data migrates into a legacy account namespace before syncing. Account deletion removes its entire namespace, including cached summaries, without clearing shared device preferences or other accounts.

Sync rotates its starting account, processes accounts separately, and reports per-account errors while allowing healthy accounts to continue. The daily request allowance remains shared across accounts.

## Atlas storage implementation

The asynchronous storage adapter uses one MongoClient per process, a pool of up to five application connections, and finite database timeouts. `encrypted_values` stores unique string keys in MongoDB `_id` fields with AES-256-GCM ciphertext values. No database URI or raw driver error is sent to the phone or logged at startup. An encrypted marker detects an incorrect encryption key on restart. Writes are awaited before a successful API response, cursor advancement, or model request reservation.

`operation_locks` holds a renewable 90-second write lease; an AsyncLocalStorage context permits nested calls within the same operation. Requests to read status and summaries remain available while syncing. Leases reduce overlapping-deployment races but are not multi-record transactions: a process crash can still leave partially completed linking or disconnect operations. Keep one personal backend instance.

Mail lists remain stored as an encrypted value per account. Individual plaintext values are limited to 10 MiB to stay below MongoDB's document size ceiling after encoding. Very large backfills require a future per-message storage redesign. There is no claim of unlimited storage; Atlas free quotas apply.

Switching storage does not automatically upload any existing local SQLite database. Reconnect Gmail in the new Atlas-backed deployment to regenerate summaries. Keep any old SQLite file and encryption key if historical local state must be recovered later. No existing local database is deleted by this change.
