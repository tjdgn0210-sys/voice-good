import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Pressable, Text, View } from 'react-native';
import type { ExpenseFeedback } from '../../application/expenses/manual-expenses';
import { useExpenses } from '../capture/expense-context';
import { expenseStyles as styles } from '../capture/expense-styles';

export function ExpenseUndoFeedback({ onResult, refreshKey }: { onResult(): void; refreshKey: number }) {
  const expenses = useExpenses();
  const [feedback, setFeedback] = useState<ExpenseFeedback | null>(() => expenses.feedback());
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer) clearTimeout(timer);
      const current = expenses.feedback();
      setFeedback(current);
      if (current?.status === 'SAVED') {
        const remaining = Date.parse(current.reversibleUntil) - Date.parse(expenses.now());
        timer = setTimeout(update, Math.max(1, Math.min(remaining + 1, 60_001)));
      }
    };
    update();
    setMessage(null);
    // Recheck on resume because mobile background timers may be suspended.
    const subscription = AppState.addEventListener('change', update);
    return () => { if (timer) clearTimeout(timer); subscription.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [expenses, refreshKey]));

  async function reverse() {
    if (busy.current || !feedback || feedback.status !== 'SAVED') return;
    busy.current = true; // Immediate guard before React renders the disabled button.
    setWorking(true);
    setMessage(null);
    try {
      const result = await expenses.undo(feedback.undoId);
      if (result.status !== 'SUCCESS') {
        setMessage(result.message);
        if (result.status === 'FAILED') console.error('Manual expense Undo failed.');
      }
    } catch {
      console.error('Manual expense Undo could not be completed.');
      setMessage('실행취소를 확인하지 못했습니다. 목록을 다시 확인해 주세요.');
    } finally {
      setFeedback(expenses.feedback());
      busy.current = false;
      setWorking(false);
      onResult(); // Reload even on failure: never assume a row was deleted.
    }
  }

  if (!feedback) return null;
  return <View style={styles.softCard}>
    <Text style={styles.text} accessibilityLiveRegion="polite">
      {feedback.status === 'UNDONE' ? '지출 기록을 취소했습니다.' : feedback.label}
    </Text>
    {feedback.status === 'SAVED' && <>
      <Text style={styles.muted}>저장 후 60초 동안 실행취소할 수 있습니다. 앱을 다시 시작하면 사용할 수 없습니다.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: working, busy: working }}
        disabled={working} style={[styles.button, working && styles.disabled]} onPress={reverse}>
        <Text style={styles.buttonText}>{working ? '취소 중…' : '실행취소'}</Text>
      </Pressable>
    </>}
    {feedback.status === 'EXPIRED' && <Text style={styles.muted}>실행취소 가능 시간이 끝났습니다.</Text>}
    {feedback.status === 'UNAVAILABLE' && <Text style={styles.muted}>이 기록은 더 이상 실행취소할 수 없습니다.</Text>}
    {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
  </View>;
}
