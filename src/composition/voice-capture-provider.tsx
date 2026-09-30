import { useState, type PropsWithChildren } from 'react';
import { useExpenses } from '../features/capture/expense-context';
import { VoiceCaptureContext } from '../features/capture/voice-capture-context';
import { useInterpretCapture } from '../features/capture/interpretation-context';
import { createVoiceCapture } from './voice-capture';

export function VoiceCaptureProvider({ children }: PropsWithChildren) {
  const expenses = useExpenses();
  const interpret = useInterpretCapture();
  const [voiceCapture] = useState(() => createVoiceCapture(expenses, interpret));
  return <VoiceCaptureContext.Provider value={voiceCapture}>{children}</VoiceCaptureContext.Provider>;
}
