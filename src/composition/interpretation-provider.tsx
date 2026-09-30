import { useEffect, useState, type PropsWithChildren } from 'react';
import { createHttpCaptureAiClient } from '../adapters/ai/http-capture-ai-interpreter';
import { createCaptureInterpretationService } from '../application/proposals/interpret-capture-input';
import { useExpenses } from '../features/capture/expense-context';
import { InterpretationContext } from '../features/capture/interpretation-context';
import { AiConnectionContext } from '../features/settings/ai-connection-context';
export function InterpretationProvider({ children }: PropsWithChildren) {
  const expenses = useExpenses();
  const [client] = useState(() => createHttpCaptureAiClient({ newRequestId: expenses.newActionId }));
  const [interpret] = useState(() => createCaptureInterpretationService(client.interpreter));
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  useEffect(() => () => client.disconnect(), [client]);
  return <AiConnectionContext.Provider value={{ serverUrl,
    async connect(url, token) { setServerUrl(null); const session = await client.connect(url, token); setServerUrl(session.serverUrl); return session.usage; },
    disconnect() { client.disconnect(); setServerUrl(null); },
  }}><InterpretationContext.Provider value={interpret}>{children}</InterpretationContext.Provider></AiConnectionContext.Provider>;
}
