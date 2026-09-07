import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Reminder } from '../api/types';
import { formatWhen } from '../format';
import { useTheme } from '../theme';

/** Per the architecture doc: a confident parse confirms for ~2s and vanishes. */
const CONFIRM_MS = 2000;

export type Result =
  | { kind: 'confirmed'; reminder: Reminder }
  | { kind: 'unsure'; reminder: Reminder }
  | { kind: 'error'; message: string; transcript?: string };

interface Props {
  result: Result;
  onDismiss: () => void;
  onEdit: (reminder: Reminder) => void;
}

export function ResultBanner({ result, onDismiss, onEdit }: Props) {
  const theme = useTheme();

  // Only the confident case self-dismisses. An unsure parse or an error stays
  // until acknowledged — a 2s glimpse of a guess is worse than no confirmation.
  useEffect(() => {
    if (result.kind !== 'confirmed') return;
    const timer = setTimeout(onDismiss, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (result.kind === 'error') {
    return (
      <Pressable
        onPress={onDismiss}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.danger }]}
      >
        <Text style={[styles.title, { color: theme.danger }]}>{result.message}</Text>
        {result.transcript ? (
          <Text style={[styles.body, { color: theme.muted }]}>
            Heard: “{result.transcript}”
          </Text>
        ) : null}
        <Text style={[styles.hint, { color: theme.muted }]}>Tap to dismiss</Text>
      </Pressable>
    );
  }

  const { reminder } = result;

  if (result.kind === 'confirmed') {
    return (
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.success }]}>
        <Text style={[styles.title, { color: theme.text }]}>{reminder.task}</Text>
        <Text style={[styles.body, { color: theme.success }]}>
          {formatWhen(reminder.remind_at)}
        </Text>
      </View>
    );
  }

  // Low confidence: show what Claude assumed and make the time tappable, rather
  // than flashing a guess for two seconds and hoping it was right.
  return (
    <View style={[styles.card, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
      <Text style={[styles.title, { color: theme.text }]}>{reminder.task}</Text>
      <Pressable onPress={() => onEdit(reminder)}>
        <Text style={[styles.body, styles.editable, { color: theme.warning }]}>
          {formatWhen(reminder.remind_at)}
        </Text>
      </Pressable>
      {reminder.ambiguity_note ? (
        <Text style={[styles.note, { color: theme.muted }]}>{reminder.ambiguity_note}</Text>
      ) : null}
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Text style={[styles.hint, { color: theme.muted }]}>Looks right — dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 4,
    width: '100%',
  },
  title: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '500' },
  editable: { textDecorationLine: 'underline' },
  note: { fontSize: 13, marginTop: 2 },
  hint: { fontSize: 12, marginTop: 6 },
});
