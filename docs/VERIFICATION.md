# Verification record

## Automated checks

- Backend: 20 tests pass using Node's built-in test runner. Covers text reduction, token caps, structured output, provider routing, MIME parsing, encryption round trips, authentication, invalid OAuth state, consent, duplicate processing, cache reuse, daily limits, concurrent sync, and notification retries. Multi-account checks also cover migration, duplicate relinking, ID isolation, account deletion, per-account preferences, a shared budget, partial sync failures, and OAuth linking through a mock provider.
- Mobile: TypeScript strict check passes with Expo SDK 57 and React Native 0.86.3.
- Android and web JavaScript exports are checked using Expo. A JavaScript export is not an APK or a physical-device test.

## Browser UI checks

The React Native Web preview was inspected at a 390 × 844 viewport in light and dark themes. Verified navigation, email search, opening a summary, archiving a sample message, and finding it in the Archived filter. Sample content is explicitly labeled throughout. The updated multi-account preview was also checked: personal filter shows three personal messages, work filter shows two work messages, All accounts restores all five, and Settings shows independent account notification controls.

## Dependency audit

The project was upgraded to stable Expo 57.0.26, aligned with the SDK's native dependencies, and compatible `npm audit fix` updates were applied. The audit still reports 23 dependency-tree findings (16 high, 7 moderate), stemming from `braces`, `node-forge`, and `uuid` in the Expo/Metro/Xcode tooling chains. npm's suggested forced remedy downgrades Expo to 44 and is not an appropriate compatible fix. These findings remain unresolved; review upstream fixes before a production release. The API runtime has no third-party npm dependencies.

## Not verified without your configuration

- Real Gmail OAuth consent, token refresh, and mailbox synchronization.
- Live Gemini/Ollama summary quality and actual provider usage.
- Expo/FCM delivery and notification navigation on physical Android hardware.
- Native APK build, signing, installation, TalkBack, and store release.
- Deployment behind your HTTPS domain and reverse proxy.
