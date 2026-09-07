import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { completeReminder, deleteReminder, listReminders } from '../src/api/reminders';
import { Reminder } from '../src/api/types';
import { formatWhen } from '../src/format';
import { cancelReminder } from '../src/notifications';
import { Theme, useTheme } from '../src/theme';

const STATUS_MARK: Record<Reminder['status'], string> = {
  pending: '○',
  snoozed: '◐',
  completed: '✓',
  dismissed: '✕',
};

const statusColor = (status: Reminder['status'], theme: Theme) =>
  status === 'completed'
    ? theme.success
    : status === 'dismissed'
      ? theme.muted
      : theme.accent;

export default function History() {
  const theme = useTheme();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReminders(await listReminders({ limit: 100 }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reminders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remove = useCallback(async (id: string) => {
    // Optimistic: the row disappears immediately, the resync on next foreground
    // corrects it if the request actually failed.
    setReminders((prev) => prev.filter((r) => r.id !== id));
    await cancelReminder(id);
    try {
      await deleteReminder(id);
    } catch {
      void load();
    }
  }, [load]);

  const complete = useCallback(async (id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'completed', next_fire_at: null } : r)),
    );
    await cancelReminder(id);
    try {
      await completeReminder(id);
    } catch {
      void load();
    }
  }, []);

  // `next_fire_at` is null exactly when a reminder is acknowledged, which is
  // also what separates the two sections.
  const upcoming = reminders.filter((r) => r.next_fire_at);
  const past = reminders.filter((r) => !r.next_fire_at);

  const sections = [
    { title: 'UPCOMING', data: upcoming },
    { title: 'EARLIER', data: past },
  ].filter((s) => s.data.length > 0);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SectionList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.accent} />
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.muted }]}>
          {error ?? 'No reminders yet. Tap the mic on the home screen.'}
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.header, { color: theme.muted, backgroundColor: theme.bg }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <View style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Pressable
            onPress={() => item.next_fire_at && complete(item.id)}
            hitSlop={8}
            accessibilityLabel={`Mark ${item.task} done`}
          >
            <Text style={[styles.mark, { color: statusColor(item.status, theme) }]}>
              {STATUS_MARK[item.status]}
            </Text>
          </Pressable>

          <View style={styles.rowBody}>
            <Text
              style={[
                styles.task,
                { color: theme.text },
                item.status === 'completed' && styles.struck,
              ]}
              numberOfLines={2}
            >
              {item.task}
            </Text>
            <Text style={[styles.when, { color: theme.muted }]}>
              {formatWhen(item.next_fire_at ?? item.remind_at)}
              {item.snooze_count > 0 ? `  ⤺ snoozed ×${item.snooze_count}` : ''}
            </Text>
          </View>

          <Pressable onPress={() => remove(item.id)} hitSlop={8} accessibilityLabel="Delete">
            <Text style={[styles.delete, { color: theme.muted }]}>✕</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 8 },
  header: { fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rowBody: { flex: 1, gap: 2 },
  mark: { fontSize: 20, width: 22, textAlign: 'center' },
  task: { fontSize: 16, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  when: { fontSize: 13 },
  delete: { fontSize: 16, paddingHorizontal: 4 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});
