# Frontend R1 verification

Base: `01c16fb1721e6d99dc1e07f109238f37ad334b8b` (master at review).
Release: client 1.1.0, September 2026. Product scope remains local expense capture and management.

## Checks

- TypeScript strict check: passed.
- Expo ESLint configuration, source check: passed with no errors or warnings.
- Eight Node verification scripts: passed. Existing financial/domain checks are retained. UI assertions were updated to the explicit review flow, and schema assertions to migration 2.
- Expo production web export: passed.
- Expo Android and iOS JavaScript/Hermes bundle export: passed.
- Real headless Chromium web execution with the production export and matching isolation headers: passed.

## Regression coverage

- Negation, future plans, budgets and questions do not yield local executable expense proposals.
- Composer analysis alone cannot write money; confirmation cannot run twice concurrently.
- VOICE creation goes through persistence and can be undone.
- A final voice result is handed to review once; failed interpretation preserves the final transcript.
- Editing validates required fields, preserves original input, rejects stale versions and safely replays the same action ID.
- Deletion requires explicit confirmation; replay after deletion is safe.
- ActionLog write failure rolls back expense edits and draft updates.
- Draft ordering, failure recovery and actual SQLite close/reopen preserve the last committed draft.
- Serialized web transactions prevent unrelated reads/writes from joining an in-flight transaction and recover after rejection.
- Migration upgrade/repeat execution preserve existing schema/data behavior.

## Browser journeys exercised

1. Start from an empty browser database and load home successfully.
2. Reject a budget sentence without offering save.
3. Interpret spending, review, save and Undo.
4. Open detail, persist an edit draft, reload, recover and save it.
5. Cancel deletion, then confirm deletion and return to home.
6. Validate a missing manual amount, save a manual draft, reload, recover and save it.
7. Preserve an unsupported capture sentence across reload and explicitly clear it.
8. Show an unavailable offline-speech message while keeping text/manual routes available.
9. Check 320, 390, 768 and 1440 pixel widths for horizontal overflow; inspect captured screens and a 200% CSS zoom rendering.
10. Check keyboard Tab from amount to category and absence of browser runtime errors in these journeys.

Browser reload tests wait for the explicit save/leave result before reloading. They do not imply that unfinished writes survive forced process termination. Screenshot files in `docs/previews` are browser renders, not Android/iOS screenshots. CSS zoom inspection is not a complete assistive-technology audit.

## Not verified or not included

- Physical Android/iPhone speech recognition, native permission prompts, OS interruption, background process kill and native accessibility services.
- Safari/Firefox and concurrent independent browser tabs/processes. The web queue coordinates access inside one app runtime; SQLite remains responsible for database locking across runtimes.
- Native signed installation packages, app-store distribution, server auth/sync, calendar, tasks/events UI, subscriptions or an AI provider.
- Persistent Undo history. The existing session-only 60-second creation Undo is retained and explained in the UI.

## Architecture

Routes compose feature screens. Features use application services; SQL remains in database adapters. Financial creates, edits, deletes and draft save/discard actions validate input and commit data plus local ActionLog evidence together. Draft restoration never executes a financial action. The browser database adapter queues reads and writes and supplies an unqueued transaction scope to avoid re-entrancy deadlocks.

## SDK references consulted

- https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
- https://docs.expo.dev/versions/v57.0.0/sdk/router/
- https://docs.expo.dev/llms.txt
- Installed expo-sqlite 57.0.3 sources for the unsupported web exclusive-transaction branch.
