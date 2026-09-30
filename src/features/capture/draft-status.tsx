import { Pressable, Text, View } from 'react-native';
import { expenseStyles as styles } from './expense-styles';
export function DraftStatus({ status, onRetry, onDiscard }: { status: 'idle' | 'saving' | 'saved' | 'error'; onRetry?(): void; onDiscard?(): void }) {
  if (status === 'idle') return null;
  return <View style={styles.field}><Text style={status === 'error' ? styles.error : styles.muted} accessibilityLiveRegion="polite">
    {status === 'saving' ? '초안 저장 중…' : status === 'saved' ? '이 기기에 초안이 저장되어 있습니다.' : '초안을 불러오거나 저장하지 못했습니다. 다시 시도해 주세요.'}
  </Text>{status === 'error' && onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondary}><Text style={styles.secondaryText}>초안 다시 시도</Text></Pressable>}
  {status === 'error' && onDiscard && <Pressable accessibilityRole="button" onPress={onDiscard} style={styles.secondary}><Text style={styles.secondaryText}>초안 지우고 시작</Text></Pressable>}</View>;
}
