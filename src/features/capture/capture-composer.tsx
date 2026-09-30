import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { useExpenses } from './expense-context';
import { useInterpretCapture } from './interpretation-context';
import { useVoiceCapture } from './voice-capture-context';
import { usePersistentDraft } from './use-persistent-draft';
import { DraftStatus } from './draft-status';
import { expenseStyles as styles } from './expense-styles';
import { createCaptureParserInput } from '../../application/proposals/capture-parser-router';
import type { CreateTransactionProposal } from '../../application/validator/validate-create-transaction';
import type { VoiceCaptureState } from '../../application/capture/voice-expense-capture';
export function CaptureComposer({ onSaved }: { onSaved(): void }) {
  const expenses = useExpenses();
  const voice = useVoiceCapture();
  const interpret = useInterpretCapture();
  const generation = useRef(0);
  const editor = usePersistentDraft('capture', { text: '' });
  const [review, setReview] = useState<CreateTransactionProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<VoiceCaptureState>('IDLE');
  const [partial, setPartial] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const active = state !== 'IDLE';
  useFocusEffect(useCallback(() => {
    const subscription = AppState.addEventListener('change', value => { if (value !== 'active') { generation.current++; voice.cancel(); } });
    return () => { generation.current++; voice.cancel(false); subscription.remove(); };
  }, [voice]));
  async function analyze() {
    if (busy.current || active || !editor.ready) return;
    busy.current = true; setWorking(true); setMessage(null); setReview(null);
    try {
      const revision = generation.current;
      await editor.persist();
      const draft = editor.draft;
      const parsed = await interpret(createCaptureParserInput(draft.fields.text ?? '', draft.actionId, draft.inputMethod === 'VOICE' ? 'VOICE' : 'TEXT', draft.capturedAt));
      if (revision !== generation.current) return;
      if (parsed.status === 'PARSED') setReview(parsed.proposal);
      else setMessage(`${parsed.message} 문장을 수정하거나 직접 입력해 주세요.`);
    } catch { setMessage('초안을 보존하지 못했습니다. 내용을 확인하고 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }
  async function save() {
    if (busy.current || !review) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      const result = await expenses.save(review);
      if (result.outcome?.result.status !== 'SUCCESS') { setMessage('저장을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'); return; }
      setReview(null); setPartial(''); onSaved();
      try { await editor.clear(); } catch { setMessage('지출은 저장했습니다. 초안 정리는 실패했습니다. 목록을 확인해 주세요.'); }
    } catch { setMessage('저장을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }
  async function discard() {
    if (busy.current || active) return;
    busy.current = true; setWorking(true);
    try { await editor.clear(); setReview(null); setMessage(null); setPartial(''); }
    catch { setMessage('초안을 지우지 못했습니다. 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }
  function startVoice() {
    setReview(null); setMessage(null);
    void voice.start({ onState: setState, onPartial: setPartial, onMessage: value => setMessage(value || null),
      async onTranscript(text) {
        editor.replace({ actionId: expenses.newActionId(), capturedAt: expenses.now(), inputMethod: 'VOICE', fields: { text } });
        await editor.persist();
      },
      async onReview(proposal, capturedAt) {
        editor.replace({ actionId: proposal.actionId, capturedAt, inputMethod: 'VOICE', fields: { text: proposal.sourceInput } });
        await editor.persist(); setReview(proposal); setPartial('');
      },
    });
  }
  const disabled = working || active || !editor.ready;
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>빠른 기록</Text>
    <Text style={styles.heading}>지출을 말하고, 확인하세요.</Text>
    <Text style={styles.muted}>예: “점심 7000원 썼어” · 확인 후 저장합니다.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: working || !editor.ready || (active && state !== 'LISTENING'), busy: active && state !== 'LISTENING' }}
      disabled={working || !editor.ready || (active && state !== 'LISTENING')} onPress={state === 'LISTENING' ? () => voice.stop() : startVoice}
      style={({ pressed }) => [styles.button, styles.voiceButton, pressed && styles.pressed, (working || !editor.ready) && styles.disabled]}>
      <Text style={styles.buttonText}>{state === 'LISTENING' ? '말하기 마치기' : state === 'CHECKING' ? '마이크 확인 중…' : state === 'STOPPING' ? '음성 마무리 중…' : state === 'PROCESSING' ? '입력 확인 중…' : '말하기 시작'}</Text>
    </Pressable>
    {active && <Pressable accessibilityRole="button" onPress={() => voice.cancel()} style={styles.secondary}><Text style={styles.secondaryText}>음성 입력 취소</Text></Pressable>}
    {partial !== '' && <Text style={styles.text} accessibilityLiveRegion="polite">{partial}</Text>}
    <Text style={styles.text}>문장으로 입력</Text>
    <TextInput accessibilityLabel="지출 문장 입력" placeholder="점심 7000원 썼어" placeholderTextColor="#63778A" maxLength={1000}
      value={editor.draft.fields.text ?? ''} editable={!disabled} style={styles.input} returnKeyType="done" onSubmitEditing={analyze}
      onChangeText={text => { editor.update({ text }, 'TEXT'); setReview(null); setMessage(null); }} />
    <DraftStatus status={editor.status} onRetry={() => { void editor.retry().catch(() => {}); }} onDiscard={!editor.ready ? () => { void editor.clear().catch(() => {}); } : undefined} />
    <Pressable accessibilityRole="button" disabled={disabled || !editor.draft.fields.text?.trim()} accessibilityState={{ disabled: disabled || !editor.draft.fields.text?.trim(), busy: working }}
      onPress={analyze} style={[styles.secondary, disabled && styles.disabled]}><Text style={styles.secondaryText}>{working ? '입력 처리 중…' : '입력 내용 확인'}</Text></Pressable>
    {review && <View style={[styles.card, styles.review]}>
      <Text style={styles.heading}>이 내용으로 기록할까요?</Text>
      <Text style={styles.amount}>{review.payload.amount?.toLocaleString('ko-KR')}원</Text>
      <Text style={styles.text}>{review.payload.category ?? '미분류'} · {review.payload.memo ?? '메모 없음'}</Text>
      <Text style={styles.muted}>{new Date(review.payload.occurredAt!).toLocaleString('ko-KR')} · 지출</Text>
      <Pressable accessibilityRole="button" disabled={working} accessibilityState={{ disabled: working, busy: working }} onPress={save} style={[styles.button, working && styles.disabled]}><Text style={styles.buttonText}>{working ? '지출 저장 중…' : '이 내용으로 저장'}</Text></Pressable>
      <Text style={styles.muted}>금액이나 분류가 다르면 문장을 수정하거나 직접 입력하세요.</Text>
    </View>}
    {message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => router.push('/ai-settings')} style={styles.secondary}><Text style={styles.secondaryText}>AI 연결 설정</Text></Pressable>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => router.push('/manual-expense')} style={[styles.secondary, disabled && styles.disabled]}><Text style={styles.secondaryText}>직접 입력</Text></Pressable>
      {!!editor.draft.fields.text && <Pressable accessibilityRole="button" disabled={disabled} style={styles.secondary}
        onPress={discard}><Text style={styles.secondaryText}>초안 비우기</Text></Pressable>}
    </View>
  </View>;
}
