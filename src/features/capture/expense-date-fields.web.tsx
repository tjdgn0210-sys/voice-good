import { Text, TextInput, View } from 'react-native';
import type { ExpenseDateProps } from './expense-date-fields';
import { expenseStyles as styles } from './expense-styles';
export function ExpenseDateFields({ date, time, disabled, onChange }: ExpenseDateProps) {
  return <View style={styles.field}>
    <Text style={styles.text}>발생 날짜 (YYYY-MM-DD)</Text><TextInput accessibilityLabel="발생 날짜" editable={!disabled} value={date} maxLength={10} style={styles.input} onChangeText={value => onChange({ date: value, time })} />
    <Text style={styles.text}>발생 시간 (HH:mm)</Text><TextInput accessibilityLabel="발생 시간" editable={!disabled} value={time} maxLength={5} style={styles.input} onChangeText={value => onChange({ date, time: value })} />
    <Text style={styles.muted}>기기 현지 시간 기준 · 예: 2026-09-29, 13:30</Text>
  </View>;
}
