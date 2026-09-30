import { createContext, useContext } from 'react';
export interface AiConnectionState {
  serverUrl: string | null;
  connect(url: string, token: string): Promise<{ used: number; limit: number; resetsAt: string }>;
  disconnect(): void;
}
export const AiConnectionContext = createContext<AiConnectionState | null>(null);
export function useAiConnection() {
  const context = useContext(AiConnectionContext);
  if (!context) throw new Error('AiConnectionProvider is required');
  return context;
}
