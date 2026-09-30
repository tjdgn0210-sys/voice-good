# Voice Life Manager — Fullstack R1 (1.2.0)

Full mobile/web client source, based on commit `01c16fb1721e6d99dc1e07f109238f37ad334b8b`.
This release includes the strengthened Frontend R1, an authenticated Node.js AI gateway, a real OpenAI Responses adapter, and text/voice integration. All financial writes still require local review and use the existing SQLite/ActionLog pipeline.

Start with [the server setup and API contract](server/README.md) and [release verification](docs/FULLSTACK_R1_VERIFICATION.md). No API key or deployed server is included.

## Requirements

- Node.js 24 or newer (verification used 24.19.0).
- pnpm 11.25.0. Enable the matching package manager with Corepack or install pnpm.
- Android/iOS development builds for native speech recognition. Expo Go does not include the speech module.

## Install and run

```sh
pnpm install --frozen-lockfile
pnpm start
pnpm web
```

For a native development build with a configured Android SDK or Xcode:

```sh
pnpm exec expo run:android
pnpm exec expo run:ios
```

The ZIP contains the complete project source, assets, product blueprints, migrations, lockfile and verification scripts. Dependencies, caches, Git history and generated native projects are excluded. Extract it into a new directory; do not copy old node_modules into it.

## Validate

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:web
pnpm server:test
pnpm server:check
```

Verification scripts use Node's built-in SQLite and temporary databases. They do not modify user data.
`pnpm-workspace.yaml` explicitly disables the optional unrs-resolver build script; lint uses the installed prebuilt platform package. No dependency install-script approval is required for this release.

## Connect AI

1. In `server/`, copy `.env.example` to `.env`, set the server-side OpenAI key, then run `npm start`.
2. From another terminal in `server/`, run `npm run token -- issue pilot-001 7` to issue a personal access token.
3. In the app, open **AI 연결 설정**, enter the API origin and personal token, read the transfer scope and connect.
4. Try `친구랑 커피 4500원 썼어`, select **입력 내용 확인**, review the amount/date, then select **이 내용으로 저장**.

For browser development on the same machine, use `http://localhost:3001`. The default CORS allowlist accepts the frontend on `http://localhost:8081` or `:8082`; match your actual browser origin exactly. For physical devices use HTTPS reachable by the device. A phone's localhost is the phone itself. The client intentionally refuses plain HTTP remote hosts.

The client has no hidden demo AI fallback: a missing key or disconnected server yields an error and retains the draft. Local simple parsing and manual entry continue offline. Text and voice now use the same interpreter, and navigation/backgrounding discards late voice results before saving.

## Inherited frontend features

- Home now separates today's local-date KRW total, voice/text capture and navigable expense history.
- Text and final voice interpretations require an explicit review before financial persistence.
- Negated spending, budgets, future plans and questions cannot silently become expenses.
- Voice-created expenses support the existing immediate Undo.
- Expense detail, validated editing and confirmed soft deletion use atomic local transactions and ActionLog evidence.
- Edits reject stale versions and preserve original input. Stable action IDs make retries reviewable and idempotent.
- Capture, manual-entry and edit drafts persist locally and recover after restart. No draft is automatically executed on restart.
- Web uses a serialized connection adapter so migrations and writes no longer call the unsupported web exclusive-transaction API. Native platforms retain the native exclusive API.
- Shared form/date controls, loading/error recovery, keyboard handling, limited content width and differentiated primary/secondary/destructive controls.
- CSS module declarations, lint configuration and regression scripts are included.

## Storage and recovery

Migration 2 adds `capture_drafts` and an index for action receipts. Migration 1 is unchanged. Existing records are preserved. Do not downgrade an upgraded app to a build that supports only schema 1.

Draft changes are debounced for 350 ms; the UI shows saving/saved/error state. Explicit review/save/leave actions await persistence. Abrupt process termination before a pending write completes can lose the latest keystrokes. Wait for the saved indication before forcibly closing the app.

Immediate Undo remains limited to the newest creation, 60 seconds, and the current app session. It is not a persistent Undo history. After expiry or restart, use the record detail screen to edit or delete.

Deletion removes a record from normal reads and totals using soft deletion. Financial and draft actions retain local audit evidence, including prior draft content. Clearing a draft clears the active editor slot; it is not a privacy purge of the audit log. No raw audio is retained by this application.

## Web deployment

`vercel.json` exports the SPA and supplies COOP/COEP headers required by Expo SQLite's web implementation. Keep these headers on other hosts. Browser local storage belongs to that browser/origin; it is not shared with the mobile app or another device. SQLite web support remains an Expo alpha surface; verify the browsers you intend to support.

## Release evidence and limits

See `docs/FULLSTACK_R1_VERIFICATION.md` for this release. `docs/FRONTEND_R1_VERIFICATION.md` records the earlier frontend baseline. Native bundle generation does not replace Android/iPhone device tests. No native binary was signed or submitted to an app store.
