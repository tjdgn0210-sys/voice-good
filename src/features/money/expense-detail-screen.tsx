import { useCallback, useRef, useState } from 'react';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Transaction } from '../../domain/transaction/transaction';
import { useExpenses } from '../capture/expense-context';
import { ExpenseFields } from '../capture/expense-fields';
import { expenseProposal, localDateTimeFields, type ExpenseForm } from '../capture/expense-form';
import { usePersistentDraft } from '../capture/use-persistent-draft';
import { DraftStatus } from '../capture/draft-status';
import { expenseStyles as styles } from '../capture/expense-styles';
function EditExpense({ entity, onClose }: { entity: Transaction; onClose(): void }) {
  const expenses = useExpenses();
  const draft = usePersistentDraft(`edit:${entity.id}`, { amount: String(entity.amount), category: entity.category ?? '', memo: entity.memo ?? '', ...localDateTimeFields(entity.occurredAt), expectedUpdatedAt: entity.updatedAt });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const form = { amount: '', category: '', memo: '', date: '', time: '', ...draft.draft.fields } as ExpenseForm;
  const stale = draft.ready && draft.draft.fields.expectedUpdatedAt !== entity.updatedAt;
  async function save() {
    if (busy.current || stale || !draft.ready) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      await draft.persist();
      const result = await expenses.editor.execute({ actionId: draft.draft.actionId, type: 'UPDATE_TRANSACTION', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [],
        payload: { targetId: entity.id, expectedUpdatedAt: draft.draft.fields.expectedUpdatedAt, changes: expenseProposal(draft.draft.actionId, form).payload } });
      if (result.status === 'FAILED') setMessage(result.message);
      else { await draft.clear(); onClose(); }
    } catch { setMessage('변경 또는 초안 정리를 확인하지 못했습니다. 같은 내용으로 재시도하거나 홈에서 기록을 확인해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }
  return <View style={{ gap: 20 }}>
    <Stack.Screen options={{ title: '지출 수정', gestureEnabled: !working, headerBackVisible: !working }} />
    <Text style={styles.heading}>기록 수정</Text>
    {stale && <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>이 초안을 만든 뒤 기록이 변경되었습니다. 최신 내용을 불러온 뒤 수정해 주세요.</Text><Pressable accessibilityRole="button" style={styles.secondary} onPress={() => { void draft.clear().catch(() => setMessage('초안을 초기화하지 못했습니다.')); }}><Text style={styles.secondaryText}>최신 내용으로 다시 시작</Text></Pressable></View>}
    <ExpenseFields form={form} disabled={working || !draft.ready || stale} onChange={value => { draft.update({ ...value, expectedUpdatedAt: draft.draft.fields.expectedUpdatedAt }, 'MANUAL'); setMessage(null); }} />
    <DraftStatus status={draft.status} onRetry={() => { void draft.retry().catch(() => {}); }} onDiscard={!draft.ready ? () => { void draft.clear().catch(() => {}); } : undefined} />
    {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
    <Pressable accessibilityRole="button" disabled={working || !draft.ready || stale} accessibilityState={{ disabled: working || !draft.ready || stale, busy: working }} style={styles.button} onPress={save}><Text style={styles.buttonText}>{working ? '수정 저장 중…' : '수정 저장'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={working} style={styles.secondary} onPress={() => { void draft.persist().then(onClose).catch(() => setMessage('초안 저장에 실패했습니다.')); }}><Text style={styles.secondaryText}>초안을 남기고 닫기</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={working} style={styles.secondary} onPress={() => { void draft.clear().then(onClose).catch(() => setMessage('초안을 지우지 못했습니다.')); }}><Text style={styles.secondaryText}>수정 초안 비우기</Text></Pressable>
  </View>;
}
export function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const expenses = useExpenses();
  const [entity, setEntity] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const deleteAction = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true; setLoading(true); setMessage(null);
    expenses.find(typeof id === 'string' ? id : '').then(value => { if (active) setEntity(value); }).catch(() => { if (active) setMessage('기록을 불러오지 못했습니다.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [expenses, id, attempt]));
  async function remove() {
    if (busy.current || !entity || !confirming) return;
    busy.current = true; setWorking(true); setMessage(null);
    try {
      deleteAction.current ??= expenses.newActionId();
      const result = await expenses.editor.execute({ actionId: deleteAction.current, type: 'DELETE_TRANSACTION', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [],
        payload: { targetId: entity.id, expectedUpdatedAt: entity.updatedAt, confirmed: true } });
      if (result.status === 'SUCCESS') router.dismissTo('/'); else setMessage(result.message);
    } catch { setMessage('삭제를 확인하지 못했습니다. 다시 시도해 주세요.'); }
    finally { busy.current = false; setWorking(false); }
  }
  const closeEdit = () => { setEditing(false); setAttempt(value => value + 1); };
  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <Stack.Screen options={{ title: '지출 상세', gestureEnabled: !working, headerBackVisible: !working }} />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator accessibilityLabel="기록 불러오는 중" /> : !entity ? <View style={styles.card}><Text style={styles.heading}>기록을 찾을 수 없습니다.</Text><Text style={styles.muted}>삭제되었거나 이 기기에 없는 기록입니다.</Text><Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.dismissTo('/')}><Text style={styles.secondaryText}>홈으로</Text></Pressable></View>
        : editing ? <EditExpense key={entity.id} entity={entity} onClose={closeEdit} /> : <>
          <View style={styles.card}><Text style={styles.eyebrow}>지출</Text><Text style={styles.amount}>{entity.amount.toLocaleString('ko-KR')}{entity.currencyCode === 'KRW' ? '원' : ` ${entity.currencyCode}`}</Text><Text style={styles.heading}>{entity.category ?? '미분류'}</Text><Text style={styles.text}>{entity.memo ?? '메모 없음'}</Text><Text style={styles.muted}>{new Date(entity.occurredAt).toLocaleString('ko-KR')}</Text></View>
          <View style={styles.card}><Text style={styles.heading}>기록 정보</Text><Text style={styles.muted}>입력 방식: {entity.inputMethod === 'VOICE' ? '음성' : entity.inputMethod === 'TEXT' ? '문장' : '직접 입력'}</Text>{!!entity.rawInput && <><Text style={styles.muted}>최초 입력</Text><Text style={styles.text}>{entity.rawInput}</Text></>}<Text style={styles.muted}>마지막 변경: {new Date(entity.updatedAt).toLocaleString('ko-KR')}</Text></View>
          <Pressable accessibilityRole="button" disabled={working || entity.currencyCode !== 'KRW'} style={styles.button} onPress={() => { setEditing(true); setConfirming(false); }}><Text style={styles.buttonText}>기록 수정</Text></Pressable>
          {confirming ? <View style={[styles.card, styles.danger]}><Text style={styles.heading}>이 지출을 삭제할까요?</Text><Text style={styles.text}>{entity.category ?? '미분류'} · {entity.amount.toLocaleString('ko-KR')}원</Text><Text style={styles.muted}>목록과 합계에서 제외됩니다. 이 화면에서는 복원할 수 없습니다.</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: working, busy: working }} disabled={working} onPress={remove} style={[styles.secondary, styles.danger]}><Text style={styles.dangerText}>{working ? '삭제 중…' : '삭제 확인'}</Text></Pressable><Pressable accessibilityRole="button" disabled={working} onPress={() => setConfirming(false)} style={styles.secondary}><Text style={styles.secondaryText}>유지하기</Text></Pressable></View>
            : <Pressable accessibilityRole="button" style={[styles.secondary, styles.danger]} onPress={() => setConfirming(true)}><Text style={styles.dangerText}>기록 삭제</Text></Pressable>}
        </>}
      {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
      {!editing && <Pressable accessibilityRole="button" disabled={working} style={styles.secondary} onPress={() => router.dismissTo('/')}><Text style={styles.secondaryText}>홈으로</Text></Pressable>}
      {!editing && <Pressable accessibilityRole="button" disabled={working} style={styles.secondary} onPress={() => { deleteAction.current = null; setAttempt(value => value + 1); }}><Text style={styles.secondaryText}>기록 다시 불러오기</Text></Pressable>}
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView>;
}
