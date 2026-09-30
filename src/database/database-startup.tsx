import { useEffect, useState, type PropsWithChildren } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { getDatabase } from './database';

/** Infrastructure gate only: no routes or product data access before migrations finish. */
export function DatabaseStartup({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<'LOADING' | 'READY' | 'FAILED'>('LOADING');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getDatabase().then(
      () => { if (active) setStatus('READY'); },
      () => {
        console.error('Database initialization failed. App data access is blocked.');
        if (active) setStatus('FAILED');
      },
    );
    return () => { active = false; };
  }, [attempt]);

  if (status === 'READY') return children;

  return (
    <View style={styles.container}>
      <Text accessibilityRole={status === 'FAILED' ? 'alert' : 'text'} style={styles.text}>
        {status === 'FAILED'
          ? '기록을 불러오지 못했습니다. 데이터는 초기화하지 않았습니다. 다시 시도해 주세요.'
          : '기록을 준비하고 있습니다…'}
      </Text>
      {status === 'FAILED' && (
        <Button
          title="다시 시도"
          onPress={() => {
            setStatus('LOADING');
            // getDatabase shares any in-flight initialization, including rapid retries.
            setAttempt((previous) => previous + 1);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  text: { color: '#000', textAlign: 'center' },
});
