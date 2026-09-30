# Frontend R1 changed files

Base commit: `01c16fb1721e6d99dc1e07f109238f37ad334b8b`.

This is a full source distribution, not an overlay patch. Existing product blueprints and migration 1 are retained.

## Modified

- `README.md`
- `app.json`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/verify-database.cjs`
- `scripts/verify-text-expense-parser.cjs`
- `scripts/verify-voice-capture.cjs`
- `src/adapters/speech/expo-speech-recognition-adapter.ts`
- `src/app/_layout.tsx`
- `src/application/capture/voice-expense-capture.ts`
- `src/application/proposals/action-payloads.ts`
- `src/application/proposals/capture-parser-router.ts`
- `src/application/proposals/expense-category-map.ts`
- `src/application/proposals/parse-expense-text-command.ts`
- `src/application/undo/undo-created-transaction.ts`
- `src/composition/expense-provider.tsx`
- `src/composition/manual-expenses.ts`
- `src/database/database-startup.tsx`
- `src/database/database.ts`
- `src/database/migrations/index.ts`
- `src/database/migrations/migrate.ts`
- `src/database/repositories/sqlite-action-log-repository.ts`
- `src/database/repositories/sqlite-transaction-repository.ts`
- `src/domain/action/action-type.ts`
- `src/features/capture/expense-context.tsx`
- `src/features/capture/expense-styles.ts`
- `src/features/capture/manual-expense-screen.tsx`
- `src/features/home/expense-undo-feedback.tsx`
- `src/features/home/home-screen.tsx`
- `src/hooks/use-color-scheme.web.ts`

## Added

- `docs/FRONTEND_R1_VERIFICATION.md`
- `docs/previews/capture-review.png`
- `docs/previews/expense-detail.png`
- `docs/previews/home-desktop.png`
- `docs/previews/home-mobile.png`
- `docs/previews/manual-entry.png`
- `eslint.config.js`
- `pnpm-workspace.yaml`
- `scripts/verify-frontend-hardening.cjs`
- `src/app/expense.tsx`
- `src/application/drafts/drafts.ts`
- `src/application/expenses/expense-editor.ts`
- `src/application/expenses/expense-services.ts`
- `src/database/expense-workspaces.ts`
- `src/database/migrations/002-capture-drafts.ts`
- `src/database/repositories/sqlite-draft-repository.ts`
- `src/database/serialized-web-database.ts`
- `src/domain/draft/draft.ts`
- `src/features/capture/capture-composer.tsx`
- `src/features/capture/draft-status.tsx`
- `src/features/capture/expense-date-fields.tsx`
- `src/features/capture/expense-date-fields.web.tsx`
- `src/features/capture/expense-fields.tsx`
- `src/features/capture/use-persistent-draft.ts`
- `src/features/money/expense-detail-screen.tsx`
- `src/types/styles.d.ts`
- `docs/FRONTEND_R1_CHANGES.md`

## Removed

None.
