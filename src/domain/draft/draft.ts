export interface CaptureDraft {
  actionId: string;
  capturedAt: string;
  inputMethod: 'TEXT' | 'VOICE' | 'MANUAL';
  fields: Record<string, string>;
}
export interface DraftRepository {
  read(slot: string): Promise<CaptureDraft | null>;
  write(slot: string, draft: CaptureDraft, updatedAt: string): Promise<void>;
  remove(slot: string): Promise<void>;
}
