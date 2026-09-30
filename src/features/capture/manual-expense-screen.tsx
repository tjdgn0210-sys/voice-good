import { useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenses } from './expense-context';
import { expenseProposal, initialExpenseForm, type ExpenseForm } from './expense-form';
import { expenseStyles as styles } from './expense-styles';
import { ExpenseFields } from './expense-fields';
import { usePersistentDraft } from './use-persistent-draft';
import { DraftStatus } from './draft-status';
export function ManualExpenseScreen() {
  const expenses = useExpenses();
  const draft = usePersistentDraft('manual', { ...initialExpenseForm(expenses.now()) });
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = { amount: '', category: '', memo: '', date: '', time: '', ...draft.draft.fields } as ExpenseForm;
  async function save() {
    if (busy.current || !draft.ready) return;
    busy.current = true; setSaving(true); setError(null); Keyboard.dismiss();
    try {
      await draft.persist();
      const { validation, outcome } = await expenses.save(expenseProposal(draft.draft.actionId, form));
      if (validation.status === 'NEEDS_CLARIFICATION') setError(validation.clarifications.map(item => item.question).join(' '));
      else if (validation.status !== 'VALID') setError('금액은 1원 이상의 정수로 입력하고 날짜와 시간을 확인해 주세요.');
      else if (outcome?.result.status === 'SUCCESS') {
        try { await draft.clear(); } catch { setError('지출은 저장했습니다. 초안 정리를 다시 시도하거나 홈에서 기록을 확인해 주세요.'); return; }
        router.dismissTo('/'); return;
      } else setError('저장을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');
    } catch { setError('저장을 확인하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.'); }
    finally { busy.current = false; setSaving(false); }
  }
  async function leave(discard: boolean) {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { if (discard) await draft.clear(); else await draft.persist(); router.dismissTo('/'); }
    catch { setError('초안을 처리하지 못했습니다. 입력 내용을 확인해 주세요.'); }
    finally { busy.current = false; setSaving(false); }
  }
  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <Stack.Screen options={{ title: '지출 직접 입력', gestureEnabled: !saving, headerBackVisible: !saving }} />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.heading}>지출 내용</Text><Text style={styles.muted}>필수 항목은 금액입니다. 입력한 내용은 이 기기에 초안으로 보관합니다.</Text>
        <ExpenseFields form={form} disabled={saving || !draft.ready} onChange={value => { draft.update({ ...value }, 'MANUAL'); setError(null); }} />
        <DraftStatus status={draft.status} onRetry={() => { void draft.retry().catch(() => {}); }} onDiscard={!draft.ready ? () => { void draft.clear().catch(() => {}); } : undefined} />
        {error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !draft.ready, busy: saving }} disabled={saving || !draft.ready} style={[styles.button, saving && styles.disabled]} onPress={save}><Text style={styles.buttonText}>{saving ? '지출 저장 중…' : '지출 저장'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={saving} style={styles.secondary} onPress={() => leave(false)}><Text style={styles.secondaryText}>초안을 남기고 돌아가기</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={saving} style={styles.secondary} onPress={() => leave(true)}><Text style={styles.secondaryText}>입력 비우고 돌아가기</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
