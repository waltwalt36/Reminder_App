import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';

import { CATEGORY_ID } from '../notifications';
import { useTheme } from '../theme';

/**
 * Temporary diagnostic strip.
 *
 * "Test 15s" schedules a notification directly with iOS — no backend, no
 * network, no reminder record. If that one fails to fire, the problem is
 * permissions or Expo Go itself, not any of our scheduling logic.
 */
export function NotifDebug() {
  const theme = useTheme();
  const [perm, setPerm] = useState('?');
  const [queued, setQueued] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    const p = await Notifications.getPermissionsAsync();
    setPerm(`${p.status}${p.ios?.allowsAlert ? ' alert' : ' NO-ALERT'}${p.ios?.allowsSound ? ' sound' : ' NO-SOUND'}`);
    setQueued((await Notifications.getAllScheduledNotificationsAsync()).length);
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const testLocal = useCallback(async () => {
    setNote('scheduling…');
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Local test',
          body: 'If you see this, iOS notifications work.',
          sound: true,
          categoryIdentifier: CATEGORY_ID,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 15,
          repeats: false,
        },
      });
      setNote(`scheduled ${id.slice(0, 8)} — lock phone, wait 15s`);
      await refresh();
    } catch (err) {
      setNote(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refresh]);

  return (
    <View style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
      <Text style={[styles.line, { color: theme.muted }]}>
        perms: {perm} · iOS queue: {queued ?? '…'}
      </Text>
      {note ? <Text style={[styles.line, { color: theme.warning }]}>{note}</Text> : null}
      <View style={styles.row}>
        <Pressable onPress={testLocal} hitSlop={8}>
          <Text style={[styles.btn, { color: theme.accent }]}>Test 15s</Text>
        </Pressable>
        <Pressable onPress={refresh} hitSlop={8}>
          <Text style={[styles.btn, { color: theme.accent }]}>Refresh</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 4 },
  line: { fontSize: 11, fontFamily: 'Menlo' },
  row: { flexDirection: 'row', gap: 18 },
  btn: { fontSize: 13, fontWeight: '700' },
});
