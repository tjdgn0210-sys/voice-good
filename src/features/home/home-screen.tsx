import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Transaction } from '../../domain/transaction/transaction';
import { useExpenses } from '../capture/expense-context';
import { expenseStyles as styles } from '../capture/expense-styles';
import { CaptureComposer } from '../capture/capture-composer';
import { ExpenseUndoFeedback } from './expense-undo-feedback';
export function HomeScreen() {
  const expenses = useExpenses();
  const [items, setItems] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<{ total: number; count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(30);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false);
      const start = new Date(expenses.now()); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      try {
        const [records, totals] = await Promise.all([expenses.history(limit), expenses.summary(start.toISOString(), end.toISOString())]);
        if (active) { setItems(records); setSummary(totals); }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; subscription.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicit invalidation key reloads committed local data.
  }, [expenses, limit, attempt]));
  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
    <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      ListHeaderComponent={<View style={{ gap: 20 }}>
        <View style={styles.field}><Text style={styles.eyebrow}>VOICE LIFE MANAGER</Text><Text style={styles.title} accessibilityRole="header">오늘의 지출</Text><Text style={styles.muted}>기록은 이 기기에 보관됩니다.</Text></View>
        <View style={styles.softCard}>
          <Text style={styles.muted}>오늘 발생한 원화 지출</Text>
          <Text style={styles.amount}>{error ? '확인 필요' : summary ? `${summary.total.toLocaleString('ko-KR')}원` : '—'}</Text>
          <Text style={styles.muted}>{summary && !error ? `${summary.count}건 · 기기 현지 날짜 기준` : '기록을 확인하고 있습니다.'}</Text>
        </View>
        <ExpenseUndoFeedback refreshKey={attempt} onResult={refresh} />
        <CaptureComposer onSaved={refresh} />
        <View style={styles.field}><Text style={styles.heading} accessibilityRole="header">최근 기록</Text><Text style={styles.muted}>기록을 누르면 상세 확인과 수정이 가능합니다.</Text></View>
        {loading && <ActivityIndicator accessibilityLabel="지출 불러오는 중" />}
        {error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>최신 기록을 불러오지 못했습니다.</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.secondaryText}>다시 불러오기</Text></Pressable></View>}
      </View>}
      ListEmptyComponent={!loading && !error ? <View style={styles.softCard}><Text style={styles.heading}>첫 기록을 남겨 보세요.</Text><Text style={styles.muted}>말하거나 직접 입력한 지출을 여기에서 확인할 수 있습니다.</Text></View> : null}
      ListFooterComponent={items.length >= limit ? <Pressable accessibilityRole="button" disabled={loading} onPress={() => setLimit(value => value + 30)} style={styles.secondary}><Text style={styles.secondaryText}>이전 기록 더 보기</Text></Pressable> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.category ?? '미분류'} ${item.amount.toLocaleString('ko-KR')}원, 상세 보기`}
        onPress={() => router.push({ pathname: '/expense', params: { id: item.id } })} style={({ pressed }) => [styles.record, pressed && styles.pressed]}>
        <View style={styles.row}><Text style={styles.heading}>{item.category ?? '미분류'}</Text><Text style={styles.recordAmount}>{item.amount.toLocaleString('ko-KR')}{item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`}</Text></View>
        <Text style={styles.text} numberOfLines={2}>{item.memo ?? '메모 없음'}</Text>
        <Text style={styles.muted}>{new Date(item.occurredAt).toLocaleString('ko-KR')} · {item.inputMethod === 'VOICE' ? '음성' : item.inputMethod === 'TEXT' ? '문장' : '직접 입력'}</Text>
      </Pressable>} />
  </SafeAreaView>;
}
