import { createContext, useContext } from 'react';
import type { CaptureParserInput } from '../../application/proposals/capture-parser-router';
import type { CaptureInterpretationResult } from '../../application/proposals/interpret-capture-input';
export const InterpretationContext = createContext<((input: CaptureParserInput) => Promise<CaptureInterpretationResult>) | null>(null);
export function useInterpretCapture() {
  const interpret = useContext(InterpretationContext);
  if (!interpret) throw new Error('InterpretationProvider is required');
  return interpret;
}
