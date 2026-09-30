import type { CaptureDraft, DraftRepository } from '../../domain/draft/draft';
import type { ActionLogRepository } from '../repositories/action-log-repository';
import type { ActionProposal } from '../proposals/action-proposal';
import { isUtcDateTime } from '../validator/utc-date-time';
export function isCaptureDraft(value: unknown): value is CaptureDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as CaptureDraft;
  return typeof draft.actionId === 'string' && !!draft.actionId.trim() && isUtcDateTime(draft.capturedAt)
    && ['TEXT', 'VOICE', 'MANUAL'].includes(draft.inputMethod)
    && !!draft.fields && typeof draft.fields === 'object' && !Array.isArray(draft.fields)
    && Object.keys(draft.fields).length <= 12
    && Object.values(draft.fields).every(field => typeof field === 'string' && field.length <= 4000);
}
export interface DraftUnitOfWork {
  run<T>(work: (scope: { drafts: DraftRepository; logs: Pick<ActionLogRepository, 'append'> }) => Promise<T>): Promise<T>;
}
export function createDrafts(deps: { repository: DraftRepository; unitOfWork: DraftUnitOfWork; newId(): string; now(): string }) {
  let tail: Promise<unknown> = Promise.resolve();
  function mutate(slot: string, draft: CaptureDraft | null) {
    if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(slot) || (draft !== null && !isCaptureDraft(draft))) return Promise.reject(new Error('Invalid draft'));
    const snapshot = draft === null ? null : JSON.parse(JSON.stringify(draft)) as CaptureDraft;
    const actionId = deps.newId();
    const proposal: ActionProposal = snapshot
      ? { actionId, type: 'SAVE_DRAFT', inputMethod: snapshot.inputMethod, sourceInput: '', dependsOnActionIds: [], payload: { slot, draft: snapshot } }
      : { actionId, type: 'DISCARD_DRAFT', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [], payload: { slot } };
    const result = tail.then(() => deps.unitOfWork.run(async ({ drafts, logs }) => {
      const now = deps.now();
      if (!isUtcDateTime(now)) throw new Error('Invalid draft clock');
      if (snapshot) await drafts.write(slot, snapshot, now); else await drafts.remove(slot);
      await logs.append({ id: deps.newId(), rawInput: '', proposal, validationResult: { actionId, status: 'VALID' },
        executionResult: { actionId, affectedEntityId: slot, status: 'SUCCESS' }, createdAt: now });
    }));
    tail = result.catch(() => undefined);
    return result;
  }
  return { read: async (slot: string) => { await tail; return deps.repository.read(slot); },
    save: (slot: string, draft: CaptureDraft) => mutate(slot, draft), remove: (slot: string) => mutate(slot, null) };
}
export type Drafts = ReturnType<typeof createDrafts>;
