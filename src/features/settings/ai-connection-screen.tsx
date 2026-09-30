import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { expenseStyles as styles } from '../capture/expense-styles';
import { useAiConnection } from './ai-connection-context';
export function AiConnectionScreen() {
  const connection = useAiConnection();
  const [url, setUrl] = useState(connection.serverUrl ?? process.env.EXPO_PUBLIC_AI_SERVER_URL ?? '');
  const [token, setToken] = useState('');
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function connect() {
    if (busy.current || !consent) return;
    busy.current = true; setWorking(true); setMessage('');
    try { const usage = await connection.connect(url, token); setToken(''); setMessage(`연결했습니다. 오늘 AI 요청 ${usage.used}/${usage.limit}회 사용 · 한도 초기화 ${new Date(usage.resetsAt).toLocaleString('ko-KR')}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '연결하지 못했습니다.'); }
    finally { busy.current = false; setWorking(false); }
  }
  return <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title} accessibilityRole="header">AI 연결</Text>
    <View style={styles.card}>
      <Text style={styles.heading}>{connection.serverUrl ? 'AI가 연결되어 있습니다.' : '복잡한 지출 문장을 해석합니다.'}</Text>
      <Text style={styles.text}>단순한 지출 기록과 직접 입력은 연결 없이도 사용할 수 있습니다.</Text>
      <Text style={styles.muted}>AI 사용 시 입력한 문장, 기준 시각, 기기 시간대가 연결한 서버와 OpenAI로 전송됩니다. 음성 원본과 기존 지출 내역은 전송하지 않습니다. 외부 서비스의 데이터 처리 정책이 적용됩니다.</Text>
      <Text style={styles.muted}>해석 결과는 확인 후 이 기기에 저장됩니다. 현재는 한 번에 원화 지출 한 건을 지원합니다.</Text>
      <Text style={styles.text}>서버 주소</Text>
      <TextInput accessibilityLabel="AI 서버 주소" value={url} onChangeText={setUrl} editable={!working} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://api.example.com" placeholderTextColor="#63778A" style={styles.input} />
      <Text style={styles.text}>개인 접속 토큰</Text>
      <TextInput accessibilityLabel="개인 접속 토큰" value={token} onChangeText={setToken} editable={!working} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={100} placeholder="운영자가 발급한 vlm_ 토큰" placeholderTextColor="#63778A" style={styles.input} />
      <Text style={styles.muted}>OpenAI API 키가 아닙니다. 접속 토큰은 앱 실행 중 메모리에만 보관하며, 앱을 완전히 종료하면 다시 연결해야 합니다.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: working }} disabled={working} onPress={() => setConsent(value => !value)} style={styles.secondary}>
        <Text style={styles.secondaryText}>{consent ? '☑' : '☐'} 위 전송 범위를 확인하고 AI 해석을 사용합니다.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: working || !consent, busy: working }} disabled={working || !consent} onPress={connect} style={[styles.button, (working || !consent) && styles.disabled]}>
        <Text style={styles.buttonText}>{working ? '연결 확인 중…' : 'AI 연결하기'}</Text>
      </Pressable>
      {connection.serverUrl && <Pressable accessibilityRole="button" disabled={working} onPress={() => { connection.disconnect(); setToken(''); setConsent(false); setMessage('연결을 해제했습니다. 로컬 기록은 계속 사용할 수 있습니다.'); }} style={styles.secondary}><Text style={styles.secondaryText}>AI 연결 해제</Text></Pressable>}
      {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>}
    </View>
  </ScrollView></SafeAreaView>;
}
