# Verification record

## Automated checks

- Backend: 24 tests pass against a temporary local MongoDB instance using Node's built-in test runner. Covers text reduction, token caps, structured output, provider routing, MIME parsing, encryption round trips, authentication, invalid OAuth state, consent, duplicate processing, cache reuse, daily limits, concurrent sync, and notification retries. Multi-account checks also cover migration, duplicate relinking, ID isolation, account deletion, per-account preferences, a shared budget, partial sync failures, and OAuth linking through a mock provider.
- Mobile: TypeScript strict check passes with Expo SDK 57 and React Native 0.86.3.
- Android and web JavaScript exports are checked using Expo. A JavaScript export is not an APK or a physical-device test.

## Browser UI checks

The React Native Web preview was inspected at a 390 × 844 viewport in light and dark themes. Verified navigation, email search, opening a summary, archiving a sample message, and finding it in the Archived filter. Sample content is explicitly labeled throughout. The updated multi-account preview was also checked: personal filter shows three personal messages, work filter shows two work messages, All accounts restores all five, and Settings shows independent account notification controls.

## Dependency audit

The project was upgraded to stable Expo 57.0.26, aligned with the SDK's native dependencies, and compatible `npm audit fix` updates were applied. The audit still reports 23 dependency-tree findings (16 high, 7 moderate), stemming from `braces`, `node-forge`, and `uuid` in the Expo/Metro/Xcode tooling chains. npm's suggested forced remedy downgrades Expo to 44 and is not an appropriate compatible fix. These findings remain unresolved; review upstream fixes before a production release. The API now uses the official MongoDB driver; the separate server dependency audit reports zero known vulnerabilities at this check.

## Not verified without your configuration

- Real Gmail OAuth consent, token refresh, and mailbox synchronization.
- Live Gemini/Ollama summary quality and actual provider usage.
- Expo/FCM delivery and notification navigation on physical Android hardware.
- Native APK build, signing, installation, TalkBack, and store release.
- Deployment behind your HTTPS domain and reverse proxy.

## Atlas update

All 24 tests passed with `TEST_MONGODB_URI` pointing to a disposable local MongoDB server. Checks include encrypted values inspected directly in MongoDB, reconnection persistence, wrong-key rejection, remote write-lease contention, failed-write propagation, namespace deletion, multi-account OAuth mocks, and shared usage budgets. The cloud Atlas connection itself is not yet verified because Atlas credentials and network access have not been configured. The mobile API contract is unchanged.

The actual Node entry point was smoke-tested against the temporary MongoDB: `/health` returned success and authenticated `/status` returned the expected empty account list. Cloud deployment and Docker image build were not performed in this update.
