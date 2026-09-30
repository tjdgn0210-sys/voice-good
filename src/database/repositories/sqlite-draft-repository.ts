import type { DraftRepository } from '../../domain/draft/draft';
import type { ApplicationDatabase } from '../database';
import { isCaptureDraft } from '../../application/drafts/drafts';
export function createSqliteDraftRepository(db: ApplicationDatabase): DraftRepository {
  return {
    async read(slot) {
      const row = await db.getFirstAsync<{ content_json: string }>('SELECT content_json FROM capture_drafts WHERE slot = ?', slot);
      if (!row) return null;
      const value: unknown = JSON.parse(row.content_json);
      if (!isCaptureDraft(value)) throw new Error('Invalid saved draft');
      return value;
    },
    async write(slot, draft, updatedAt) {
      await db.runAsync('INSERT INTO capture_drafts(slot, content_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(slot) DO UPDATE SET content_json=excluded.content_json, updated_at=excluded.updated_at', slot, JSON.stringify(draft), updatedAt);
    },
    async remove(slot) { await db.runAsync('DELETE FROM capture_drafts WHERE slot = ?', slot); },
  };
}
