import { createDrafts } from '../application/drafts/drafts';
import { createExpenseEditor } from '../application/expenses/expense-editor';
import type { ExpenseServices } from '../application/expenses/expense-services';
import { createDraftUnitOfWork, createExpenseEditUnitOfWork } from '../database/expense-workspaces';
import { createSqliteDraftRepository } from '../database/repositories/sqlite-draft-repository';
import { randomUUID } from 'expo-crypto';

import { createManualExpenses } from '../application/expenses/manual-expenses';
import { getDatabase } from '../database/database';
import { createSqliteTransactionRepository } from '../database/repositories/sqlite-transaction-repository';
import { createSqliteTransactionCreationUnitOfWork } from '../database/sqlite-transaction-creation-unit-of-work';

// Session-only Undo policy. No persistent Undo table; restarting loses the opportunity.
const UNDO_WINDOW_MILLISECONDS = 60_000;

export async function initializeManualExpenses(): Promise<ExpenseServices> {
  const database = await getDatabase();
  const base = createManualExpenses({
    transactions: createSqliteTransactionRepository(database),
    unitOfWork: createSqliteTransactionCreationUnitOfWork(database),
    nextActionId: randomUUID,
    nextLogId: randomUUID,
    // Separate entity namespaces can share the action UUID. No volatile ID map:
    // retries/restarts resolve the same transaction and reversal identity.
    idsForAction: actionId => ({ transactionId: actionId, undoId: actionId }),
    now: () => new Date().toISOString(),
    undoWindowMilliseconds: UNDO_WINDOW_MILLISECONDS,
  });
  const repository = createSqliteTransactionRepository(database);
  return { ...base,
    drafts: createDrafts({ repository: createSqliteDraftRepository(database), unitOfWork: createDraftUnitOfWork(database), newId: randomUUID, now: base.now }),
    editor: createExpenseEditor({ unitOfWork: createExpenseEditUnitOfWork(database), newId: randomUUID, now: base.now }),
    find: repository.findById,
    history: repository.listExpenses,
    summary: async (from, until) => (await database.getFirstAsync<{ total: number; count: number }>(
      "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM transactions WHERE deleted_at IS NULL AND type='EXPENSE' AND currency_code='KRW' AND occurred_at >= ? AND occurred_at < ?", from, until))!,
  };
}
