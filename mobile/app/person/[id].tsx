import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteInteraction, deletePerson, deleteTranscript, getCoaching, getPerson, Person } from '../../src/api/connections';
import { AppBottomNav } from '../../src/components/AppBottomNav';
import { useTheme } from '../../src/theme';

export default function PersonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [person, setPerson] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setPerson(await getPerson(id)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load this connection.'); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const removePerson = () => Alert.alert('Delete this person?', 'This also deletes their notes and follow-ups.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { void deletePerson(id).then(() => router.replace('/people')).catch(e => Alert.alert('Could not delete', e.message)); } },
  ]);
  const coach = async () => {
    setBusy(true);
    try { setSuggestion((await getCoaching(id)).suggestion); }
    catch (e) { Alert.alert('Suggestion unavailable', e instanceof Error ? e.message : 'Try again later.'); }
    finally { setBusy(false); }
  };
  if (!person) return <SafeAreaView style={[styles.center, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}><Text style={[styles.brand, { color: theme.muted }]}>THREAD · CONNECTIONS</Text>{error ? <Text style={{ color: theme.muted }}>{error}</Text> : <ActivityIndicator color={theme.accent} />}<AppBottomNav /></SafeAreaView>;

  return <SafeAreaView style={[styles.page, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={{ color: theme.accent }}>‹  People</Text></Pressable>
      <Text style={[styles.brand, { color: theme.muted }]}>PERSON</Text>
      <Text style={[styles.title, { color: theme.text }]}>{person.name}</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>{person.organization || 'Organization not set'}</Text>
      <View style={styles.tags}><Text style={[styles.tag, { color: theme.accent, backgroundColor: theme.accentSoft }]}>{person.relationship_state.replace(/_/g, ' ')}</Text>{person.active_reminder_count > 0 && <Text style={[styles.tag, { color: theme.accent, backgroundColor: theme.accentSoft }]}>{person.active_reminder_count} active follow-up{person.active_reminder_count === 1 ? '' : 's'}</Text>}</View>

      <Text style={[styles.section, { color: theme.muted }]}>YOUR NOTES</Text>
      {person.interactions.length > 0 ? <Text style={[styles.summary, { color: theme.text }]}>{person.interactions[0].summary || 'No summary saved yet.'}</Text> : <Text style={{ color: theme.muted }}>No notes yet.</Text>}

      <Text style={[styles.section, { color: theme.muted }]}>HISTORY</Text>
      {person.interactions.length ? <View style={[styles.timeline, { borderColor: theme.border }]}>{person.interactions.map((interaction) => <View key={interaction.id} style={styles.event}>
        <View style={[styles.dot, { backgroundColor: theme.accent }]} />
        <Text style={[styles.eventTitle, { color: theme.text }]}>{interaction.kind.replace(/_/g, ' ')}</Text>
        <Text style={[styles.eventDate, { color: theme.muted }]}>{interaction.occurred_at ? new Date(interaction.occurred_at).toLocaleDateString() : 'Date not set'} · {interaction.source === 'voice' ? 'Note captured by voice' : 'Note saved'}</Text>
        {interaction.summary ? <Text style={[styles.eventSummary, { color: theme.text }]}>{interaction.summary}</Text> : null}
        {interaction.transcript ? <View style={styles.transcriptBlock}><Text style={[styles.transcript, { color: theme.muted }]}>{interaction.transcript}</Text><Pressable onPress={() => Alert.alert('Delete transcript?', 'The summary and timeline entry will remain.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteTranscript(interaction.id).then(load) }])}><Text style={[styles.destructive, { color: theme.danger }]}>Delete transcript</Text></Pressable></View> : <Text style={{ color: theme.muted, fontSize: 13 }}>Transcript deleted</Text>}
        <Pressable onPress={() => Alert.alert('Delete this note?', 'This may cancel follow-ups linked to it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteInteraction(interaction.id).then(load) }])}><Text style={[styles.deleteNote, { color: theme.muted }]}>Delete timeline entry</Text></Pressable>
      </View>)}</View> : <Text style={{ color: theme.muted }}>No interactions recorded.</Text>}

      {suggestion ? <View style={[styles.idea, { backgroundColor: theme.accentSoft }]}><Text style={[styles.ideaLabel, { color: theme.accent }]}>ONE IDEA</Text><Text style={[styles.summary, { color: theme.text }]}>{suggestion}</Text><Text style={[styles.eventDate, { color: theme.muted }]}>Based on your saved note · Nothing is sent automatically.</Text></View> : <Pressable onPress={() => void coach()} disabled={busy} style={[styles.ideaButton, { borderColor: theme.border }]}><Text style={{ color: theme.accent }}>{busy ? 'Thinking…' : 'Suggest a next step'}</Text></Pressable>}
      <Pressable onPress={removePerson} style={styles.deletePerson}><Text style={[styles.destructive, { color: theme.danger }]}>Delete person and all history</Text></Pressable>
    </ScrollView>
    <AppBottomNav />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 30, gap: 8 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 }, back: { minHeight: 35, justifyContent: 'center', alignSelf: 'flex-start' }, brand: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2 }, title: { fontSize: 31, fontWeight: '500', marginTop: 2 }, subtitle: { fontSize: 16 }, tags: { flexDirection: 'row', gap: 8, marginTop: 5, flexWrap: 'wrap' }, tag: { overflow: 'hidden', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, fontSize: 13, textTransform: 'capitalize' }, section: { fontSize: 13, fontWeight: '500', letterSpacing: 0.7, marginTop: 22 }, summary: { fontSize: 16, lineHeight: 23 }, timeline: { borderLeftWidth: 1, marginLeft: 6, paddingLeft: 20, marginTop: 4 }, event: { position: 'relative', paddingBottom: 23, gap: 6 }, dot: { position: 'absolute', left: -25, top: 6, width: 10, height: 10, borderRadius: 5 }, eventTitle: { fontSize: 16, fontWeight: '500', textTransform: 'capitalize' }, eventDate: { fontSize: 13, lineHeight: 18 }, eventSummary: { fontSize: 15, lineHeight: 21 }, transcriptBlock: { gap: 8, paddingTop: 3 }, transcript: { fontSize: 14, lineHeight: 20 }, destructive: { fontSize: 14 }, deleteNote: { fontSize: 13, paddingTop: 3 }, idea: { borderRadius: 16, padding: 15, gap: 7, marginTop: 8 }, ideaLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8 }, ideaButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8 }, deletePerson: { alignItems: 'center', paddingVertical: 24 } });
