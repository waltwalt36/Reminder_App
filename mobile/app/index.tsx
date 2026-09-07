import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createFromVoice, listReminders } from '../src/api/reminders';
import { ApiError, LOW_CONFIDENCE, Reminder } from '../src/api/types';
import { useVoiceCapture } from '../src/audio/useVoiceCapture';
import { MicButton } from '../src/components/MicButton';
import { Result, ResultBanner } from '../src/components/ResultBanner';
import { formatCountdown, formatWhen } from '../src/format';
import { scheduleReminder } from '../src/notifications';
import { useTheme } from '../src/theme';

export default function Home() {
  const theme = useTheme();
  const [next, setNext] = useState<Reminder | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const refreshNext = useCallback(async () => {
    try {
      const upcoming = await listReminders({ upcoming: true, limit: 1 });
      setNext(upcoming[0] ?? null);
    } catch {
      // Offline — leave whatever is on screen rather than blanking it.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshNext();
    }, [refreshNext]),
  );

  const handleAudio = useCallback(
    async (uri: string) => {
      try {
        const { reminder } = await createFromVoice(uri);
        await scheduleReminder(reminder);

        const confident = (reminder.parse_confidence ?? 1) >= LOW_CONFIDENCE;
        setResult({ kind: confident ? 'confirmed' : 'unsure', reminder });
        await refreshNext();
      } catch (err) {
        console.warn('[home] voice flow failed:', err);
        const apiErr = err instanceof ApiError ? err : null;
        setResult({
          kind: 'error',
          message: apiErr?.message ?? 'Something went wrong.',
          transcript: apiErr?.transcript,
        });
      }
    },
    [refreshNext],
  );

  const { state, level, start, stop } = useVoiceCapture({
    onResult: handleAudio,
    onError: (message) => setResult({ kind: 'error', message }),
  });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]} edges={['bottom']}>
      <View style={styles.top}>
        {result ? (
          <ResultBanner
            result={result}
            onDismiss={() => setResult(null)}
            onEdit={() => setResult(null)}
          />
        ) : next?.next_fire_at ? (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.eyebrow, { color: theme.muted }]}>NEXT</Text>
            <Text style={[styles.task, { color: theme.text }]} numberOfLines={2}>
              {next.task}
            </Text>
            <Text style={[styles.when, { color: theme.accent }]}>
              {formatWhen(next.next_fire_at)} · {formatCountdown(next.next_fire_at)}
            </Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.muted }]}>
              Nothing scheduled.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.middle}>
        <MicButton state={state} level={level} onPress={state === 'listening' ? stop : start} />
      </View>

      <View style={styles.bottom}>
        <Link href="/history" asChild>
          <Pressable hitSlop={12}>
            <Text style={[styles.link, { color: theme.accent }]}>History →</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  top: { minHeight: 132, justifyContent: 'center', paddingTop: 8 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: { alignItems: 'center', paddingBottom: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  task: { fontSize: 20, fontWeight: '600' },
  when: { fontSize: 15, fontWeight: '500' },
  empty: { alignItems: 'center' },
  emptyText: { fontSize: 15 },
  link: { fontSize: 16, fontWeight: '600' },
});
