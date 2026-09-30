import type { ApplicationDatabase } from './database';
import type { DraftUnitOfWork } from '../application/drafts/drafts';
import type { ExpenseEditUnitOfWork } from '../application/expenses/expense-editor';
import type { ActionLog } from '../application/proposals/action-log';
import { createSqliteDraftRepository } from './repositories/sqlite-draft-repository';
import { createSqliteTransactionRepository } from './repositories/sqlite-transaction-repository';
import { createSqliteActionLogRepository } from './repositories/sqlite-action-log-repository';
export function createDraftUnitOfWork(db: ApplicationDatabase): DraftUnitOfWork {
  return { async run(work) {
    let result!: Awaited<ReturnType<typeof work>>;
    await db.withExclusiveTransactionAsync(async tx => { result = await work({ drafts: createSqliteDraftRepository(tx), logs: createSqliteActionLogRepository(tx) }); });
    return result;
  } };
}
export function createExpenseEditUnitOfWork(db: ApplicationDatabase): ExpenseEditUnitOfWork {
  return { async run(work) {
    let result!: Awaited<ReturnType<typeof work>>;
    await db.withExclusiveTransactionAsync(async tx => {
      result = await work({ transactions: createSqliteTransactionRepository(tx), logs: createSqliteActionLogRepository(tx),
        async receipt(actionId) {
          const row = await tx.getFirstAsync<{ proposal_json: string }>("SELECT proposal_json FROM action_logs WHERE json_valid(proposal_json) AND json_extract(proposal_json, '$.actionId') = ? AND json_extract(execution_result_json, '$.status') = 'SUCCESS' LIMIT 1", actionId);
          return row ? { proposal: JSON.parse(row.proposal_json) } as ActionLog : null;
        } });
    });
    return result;
  } };
}
