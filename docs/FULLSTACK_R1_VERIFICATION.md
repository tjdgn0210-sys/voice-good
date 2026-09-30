# Fullstack R1 verification — 2026-09-30

Baseline: delivered Frontend R1 1.1.0, originally based on GitHub commit `01c16fb1721e6d99dc1e07f109238f37ad334b8b`. App version now 1.2.0; gateway 1.0.0. This is a full source package, not a patch. No GitHub push or public deployment was performed.

## Scope delivered

- `server/src/{config,contracts,provider,store,server,main,token-cli}.mjs`: zero external runtime dependency Node.js 24 gateway, pilot token auth, SQLite quota/lease/idempotency ledger, OpenAI Responses strict extraction, deterministic envelope, timeout/no-auto-retry/error mapping.
- `src/adapters/ai/http-capture-ai-interpreter.ts`: authenticated transport, HTTPS/loopback URL rules, timeouts, connection invalidation, RAM-only credentials.
- `src/composition/interpretation-provider.tsx`, capture/settings contexts and AI settings route: consent, connection check, both text and voice wired to one local-first interpretation service.
- `src/features/capture/capture-composer.tsx`: async interpretation, draft preservation, explicit review/save, stale text result suppression.
- `src/application/capture/voice-expense-capture.ts`: cancel during delayed interpretation invalidates the session; it cannot fall into the legacy auto-save callback after losing focus. A dated proposal no longer overwrites the original capture reference time used for re-interpretation.
- Server tests, actual HTTP-to-client-to-SQLite regression and optional browser script; setup/API/privacy/operations documentation and Dockerfile.
- Existing CRUD, migrations, draft storage, Undo, local amount parsing and offline operation retained. Client schema remains version 2.

## Completed checks

| Check | Result |
| --- | --- |
| Frontend TypeScript (`tsc --noEmit`) | Passed |
| Frontend ESLint | Passed |
| Root Node verification suite | 9 scripts passed, including real HTTP gateway/client/SQLite integration |
| Gateway `node --test` | 8 tests passed; auth/limits/replay/restart/schema/errors/time ambiguity |
| Gateway JavaScript syntax checks | Passed |
| Expo export | Web, Android and iOS bundles generated |
| Headless Chromium + production web bundle + real HTTP gateway | Passed; provider result was a fixture |
| AI settings widths 320/390/768/1440 px | No horizontal overflow |
| Browser runtime errors | None in the tested flow |

The browser flow tested explicit transfer consent before connecting, personal token authentication, clearing the token input after connection, complex text → proposal with no pre-confirmation record, confirmed save to actual Expo web SQLite, AI timeout with editable draft retained, reload with record and draft recovery, RAM session reset, and local simple parsing without another network interpretation. Screenshots: `docs/previews/ai-connection-mobile.png`, `docs/previews/ai-review-mobile.png`. These show a test server/fixture, not evidence of a live model response.

The HTTP integration regression additionally verifies client envelope tamper rejection, application validation, SQLite ActionLog writes, duplicate-safe saving, Undo and navigation cancellation during delayed voice interpretation. Server tests verify quota state survives reopening the database and that independent DB handles cannot over-reserve the same global allowance.

Reproduce core checks from the project root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm server:test
pnpm server:check
pnpm exec expo export --platform all
```

Optional browser regression is `scripts/browser-ai-smoke.cjs`. It requires an available Playwright Node module and Chromium browser. Install Playwright in a separate tooling directory if needed; set `PLAYWRIGHT_MODULE_PATH` to its absolute `index.js` and `CHROMIUM_EXECUTABLE` to an installed Chromium binary. Run it from the project root after web export. Verification here used Playwright's Chromium Headless Shell 134 (build 1161), with Noto Sans KR available. The browser script starts its own temporary gateway/static server and generates the two preview files. It neither deploys nor invokes OpenAI.

## Not verified / release limits

- No usable OpenAI API key was available: no live billable model call, account/model-access check, latency benchmark or Korean semantic accuracy evaluation was performed. Real adapter code is included, and its request/response/error contract was tested with fixtures.
- No physical Android/iPhone microphone/permission/background lifecycle test, native signed binary or app-store submission. Native bundle export is not device verification.
- Dockerfile supplied but container build/runtime was not exercised here. No HTTPS proxy, domain, production volume or live hosting was provisioned.
- Pilot operator-issued access tokens only; no self-service signup/password recovery/OAuth, secure persistent client login, payments or multi-device sync.
- One KRW expense per interpretation. Tasks, events, compound action execution, reminders and external calendar integration remain future work. Ambiguity returns a message and retains text; it does not create a persistent multi-turn conversation.
- Cost allowance uses operator-configured reservation units, not provider billing reconciliation or a guaranteed dollar cap. See server README for defaults and deployment boundary.
- Backend is a long-lived single-instance/local-volume design. SQLite persistence and RAM-only replay cache are not a multi-region service.
- Existing Frontend R1 limits continue: newest creation Undo is 60 seconds/session-only; soft-delete and draft audit evidence remain locally; draft debounce may lose last keystrokes on forced termination.

Before a real pilot, configure the API key/HTTPS endpoint, issue individual tokens, verify model access, and run a small live corpus including negation, budget/plan/quoted sentences, multiple amounts, relative dates, AM/PM ambiguity, Korean numerals and dialect. Review factual extraction quality before expanding supported actions. The UI always asks the user to confirm the resulting record.
