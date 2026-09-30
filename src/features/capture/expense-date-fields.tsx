import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { localDateTimeFields } from './expense-form';
import { expenseStyles as styles } from './expense-styles';
export interface ExpenseDateProps { date: string; time: string; disabled: boolean; onChange(fields: { date: string; time: string }): void }
export function ExpenseDateFields({ date, time, disabled, onChange }: ExpenseDateProps) {
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const value = new Date(`${date}T${time}:00`);
  function change(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android' || event.type === 'dismissed') setPicker(null);
    if (event.type === 'set' && selected) onChange(localDateTimeFields(selected.toISOString()));
  }
  return <View style={styles.field}><Text style={styles.text}>발생 날짜와 시간</Text><View style={styles.selectionRow}>
    <Pressable accessibilityRole="button" accessibilityLabel="날짜 선택" disabled={disabled} onPress={() => setPicker('date')} style={styles.selectionButton}><Text style={styles.selectionText}>{date}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="시간 선택" disabled={disabled} onPress={() => setPicker('time')} style={styles.selectionButton}><Text style={styles.selectionText}>{time}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="현재 시간으로 재설정" disabled={disabled} onPress={() => onChange(localDateTimeFields(new Date().toISOString()))} style={styles.nowButton}><Text style={styles.nowText}>지금</Text></Pressable>
  </View><Text style={styles.muted}>기기 현지 시간 기준</Text>{picker && <DateTimePicker value={Number.isNaN(value.getTime()) ? new Date() : value} mode={picker} display={Platform.OS === 'ios' ? 'compact' : 'default'} onChange={change} disabled={disabled} />}</View>;
}
