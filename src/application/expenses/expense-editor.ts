import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import type { ActionLog } from '../proposals/action-log';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ActionLogRepository } from '../repositories/action-log-repository';
import { validateCreateTransaction } from '../validator/validate-create-transaction';
import { isUtcDateTime } from '../validator/utc-date-time';
export type ExpenseEditProposal = Extract<ActionProposal, { type: 'UPDATE_TRANSACTION' | 'DELETE_TRANSACTION' }>;
export interface ExpenseEditScope {
  transactions: Pick<TransactionRepository, 'findById' | 'update' | 'softDelete'>;
  logs: Pick<ActionLogRepository, 'append'>;
  receipt(actionId: string): Promise<ActionLog | null>;
}
export interface ExpenseEditUnitOfWork { run<T>(work: (scope: ExpenseEditScope) => Promise<T>): Promise<T> }
export function createExpenseEditor(deps: { unitOfWork: ExpenseEditUnitOfWork; now(): string; newId(): string }) {
  return {
    async execute(input: ExpenseEditProposal): Promise<{ status: 'SUCCESS' | 'FAILED'; message: string }> {
      // Snapshot before any await. All updates must carry optimistic concurrency evidence.
      const proposal: ExpenseEditProposal = JSON.parse(JSON.stringify(input));
      const { actionId, payload } = proposal;
      if (!actionId?.trim() || !payload.targetId || !isUtcDateTime(payload.expectedUpdatedAt)
        || proposal.inputMethod !== 'MANUAL' || proposal.dependsOnActionIds.length) return { status: 'FAILED', message: '기록을 다시 열어 주세요.' };
      if (proposal.type === 'DELETE_TRANSACTION' && proposal.payload.confirmed !== true) return { status: 'FAILED', message: '삭제할 기록을 먼저 확인해 주세요.' };
      try {
        return await deps.unitOfWork.run(async ({ transactions, logs, receipt }) => {
          const prior = await receipt(actionId);
          if (prior) {
            if (JSON.stringify(prior.proposal) !== JSON.stringify(proposal)) throw new Error('다른 내용으로 사용된 요청입니다. 기록을 다시 열어 주세요.');
            return { status: 'SUCCESS', message: '이미 반영된 요청입니다.' };
          }
          const current = await transactions.findById(payload.targetId!);
          if (!current || current.type !== 'EXPENSE' || current.currencyCode !== 'KRW') throw new Error('이 지출 기록을 찾을 수 없습니다.');
          if (current.updatedAt !== payload.expectedUpdatedAt) throw new Error('기록이 변경되었습니다. 다시 열어 확인해 주세요.');
          const clock = deps.now();
          if (!isUtcDateTime(clock)) throw new Error('기기 시간을 확인해 주세요.');
          const timestamp = new Date(Math.max(Date.parse(clock), Date.parse(current.updatedAt) + 1)).toISOString();
          if (proposal.type === 'UPDATE_TRANSACTION') {
            const candidate = { actionId, type: 'CREATE_TRANSACTION' as const, inputMethod: 'MANUAL' as const,
              sourceInput: '', dependsOnActionIds: [], payload: proposal.payload.changes };
            const check = validateCreateTransaction(candidate);
            if (check.status !== 'VALID' || candidate.payload.transactionType !== 'EXPENSE' || candidate.payload.currencyCode !== 'KRW') throw new Error('금액, 날짜와 시간을 확인해 주세요.');
            const changes = candidate.payload;
            if (!await transactions.update({ ...current, amount: changes.amount!, category: changes.category!, memo: changes.memo!, occurredAt: changes.occurredAt!, updatedAt: timestamp })) throw new Error('기록을 수정하지 못했습니다.');
          } else if (!await transactions.softDelete(current.id, timestamp)) throw new Error('기록을 삭제하지 못했습니다.');
          await logs.append({ id: deps.newId(), rawInput: '', proposal, validationResult: { actionId, status: 'VALID' },
            executionResult: { actionId, affectedEntityId: current.id, status: 'SUCCESS' }, createdAt: timestamp });
          return { status: 'SUCCESS', message: proposal.type === 'UPDATE_TRANSACTION' ? '수정했습니다.' : '삭제했습니다.' };
        });
      } catch (error) {
        // Do not expose database diagnostics or raw personal content.
        const known = error instanceof Error && /[가-힣]/.test(error.message);
        return { status: 'FAILED', message: known ? error.message : '변경을 확인하지 못했습니다. 같은 내용으로 재시도하거나 기록을 다시 열어 주세요.' };
      }
    },
  };
}
export type ExpenseEditor = ReturnType<typeof createExpenseEditor>;
