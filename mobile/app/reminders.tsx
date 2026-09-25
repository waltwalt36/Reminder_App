import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { editFollowUp, FollowUpReminder, getCoaching, listFollowUps, markFollowedUp } from '../src/api/connections';
import { AppBottomNav } from '../src/components/AppBottomNav';
import { cancelReminder, scheduleConnectionReminder } from '../src/notifications';
import { useTheme } from '../src/theme';

const daysFromNow = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString(); };

export default function Reminders() {
  const theme = useTheme();
  const [items, setItems] = useState<FollowUpReminder[]>([]);
  const [days, setDays] = useState('3');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [busySuggestion, setBusySuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setItems(await listFollowUps()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load follow-ups.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const finish = async (item: FollowUpReminder, withCheckIn: boolean) => {
    const daysNum = Math.max(1, Math.min(90, Number.parseInt(days, 10) || 3));
    try {
      await markFollowedUp(item.id, note, withCheckIn ? daysFromNow(daysNum) : null);
      await cancelReminder(item.id);
      if (withCheckIn) {
        const active = await listFollowUps();
        await Promise.all(active.map((reminder) => scheduleConnectionReminder(reminder, reminder.person_name)));
      }
      setNote(''); setSelected(null); await load();
    } catch (e) { Alert.alert('Could not update follow-up', e instanceof Error ? e.message : 'Please try again.'); }
  };
  const snooze = async (item: FollowUpReminder) => {
    const due = daysFromNow(1);
    try { const updated = await editFollowUp(item.id, { due_at: due, status: 'scheduled' }); await scheduleConnectionReminder(updated, item.person_name); await load(); }
    catch (e) { Alert.alert('Could not reschedule', e instanceof Error ? e.message : 'Please try again.'); }
  };
  const noAction = async (item: FollowUpReminder) => {
    try { await editFollowUp(item.id, { status: 'cancelled' }); await cancelReminder(item.id); await load(); }
    catch (e) { Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.'); }
  };
  const askForIdea = async (item: FollowUpReminder) => {
    setBusySuggestion(item.id);
    try { const result = await getCoaching(item.person); setSuggestions((previous) => ({ ...previous, [item.id]: result.suggestion })); }
    catch (e) { Alert.alert('Suggestion unavailable', e instanceof Error ? e.message : 'Try again later.'); }
    finally { setBusySuggestion(null); }
  };

  return <SafeAreaView style={[styles.page, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
    <View style={styles.heading}><Text style={[styles.brand, { color: theme.muted }]}>FOLLOW-UP · TODAY</Text><Text style={[styles.title, { color: theme.text }]}>Your next steps</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Keep it thoughtful and at your pace.</Text></View>
    {loading ? <ActivityIndicator style={{ flex: 1 }} color={theme.accent} /> : <FlatList
      style={styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={items.length ? styles.listContent : styles.emptyContent}
      ItemSeparatorComponent={() => <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border, marginHorizontal: 24 }} />}
      ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>{error || 'Nothing due right now. New follow-ups appear here after you save a connection.'}</Text>}
      renderItem={({ item }) => <View style={styles.item}>
        <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: item.person } })}>
          <Text style={[styles.person, { color: theme.text }]}>How did it go with {item.person_name || 'this person'}?</Text>
          <Text style={[styles.due, { color: theme.muted }]}>{item.title} · {new Date(item.due_at).toLocaleString()}</Text>
        </Pressable>
        {suggestions[item.id] ? <View style={[styles.idea, { backgroundColor: theme.accentSoft }]}><Text style={[styles.ideaLabel, { color: theme.accent }]}>ONE IDEA</Text><Text style={[styles.ideaText, { color: theme.text }]}>{suggestions[item.id]}</Text><Text style={[styles.ideaFoot, { color: theme.muted }]}>Based on your saved note · Nothing is sent automatically.</Text></View> : <Pressable onPress={() => void askForIdea(item)} disabled={busySuggestion === item.id} style={styles.ideaButton}><Text style={{ color: theme.accent }}>{busySuggestion === item.id ? 'Thinking…' : 'Get one idea'}</Text></Pressable>}
        <Text style={[styles.prompt, { color: theme.muted }]}>Choose what happened so your notes stay current.</Text>
        {selected === item.id ? <View style={styles.form}>
          <TextInput value={note} onChangeText={setNote} placeholder="Optional note about the follow-up" placeholderTextColor={theme.muted} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]} />
          <View style={styles.interval}><Text style={{ color: theme.muted }}>Check in again after</Text><TextInput keyboardType="number-pad" value={days} onChangeText={setDays} style={[styles.days, { color: theme.text, borderColor: theme.border }]} /><Text style={{ color: theme.muted }}>days</Text></View>
          <Pressable onPress={() => void finish(item, true)} style={[styles.primary, { backgroundColor: theme.accent }]}><Text style={styles.primaryText}>I followed up · schedule check-in</Text></Pressable>
          <Pressable onPress={() => void finish(item, false)} style={[styles.secondary, { backgroundColor: theme.accentSoft }]}><Text style={[styles.secondaryText, { color: theme.text }]}>I followed up · no check-in</Text></Pressable>
        </View> : <View style={styles.actions}>
          <Pressable onPress={() => setSelected(item.id)} style={[styles.primary, { backgroundColor: theme.accent }]}><Text style={styles.primaryText}>I followed up</Text></Pressable>
          <Pressable onPress={() => void snooze(item)} style={[styles.secondary, { backgroundColor: theme.accentSoft }]}><Text style={[styles.secondaryText, { color: theme.text }]}>Remind me tomorrow</Text></Pressable>
          <Pressable onPress={() => void noAction(item)} style={styles.noAction}><Text style={{ color: theme.muted }}>No action for now</Text></Pressable>
        </View>}
      </View>}
    />}
    <AppBottomNav />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, heading: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 10, gap: 6 }, brand: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2 }, title: { fontSize: 28, fontWeight: '500' }, subtitle: { fontSize: 15 }, list: { flex: 1 }, listContent: { paddingBottom: 18 }, emptyContent: { flex: 1, justifyContent: 'center' }, empty: { textAlign: 'center', paddingHorizontal: 30 }, item: { paddingHorizontal: 24, paddingVertical: 20, gap: 12 }, person: { fontSize: 21, lineHeight: 27, fontWeight: '500' }, due: { marginTop: 5, fontSize: 14 }, ideaButton: { alignSelf: 'flex-start', paddingVertical: 4 }, idea: { borderRadius: 16, padding: 14, gap: 5 }, ideaLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8 }, ideaText: { fontSize: 15, lineHeight: 22 }, ideaFoot: { fontSize: 12, marginTop: 3 }, prompt: { fontSize: 14 }, form: { gap: 10 }, input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 }, interval: { flexDirection: 'row', alignItems: 'center', gap: 8 }, days: { width: 54, textAlign: 'center', borderBottomWidth: StyleSheet.hairlineWidth, padding: 8 }, actions: { gap: 9 }, primary: { minHeight: 48, padding: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFFFFF', fontWeight: '600' }, secondary: { minHeight: 48, padding: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, secondaryText: { fontWeight: '500' }, noAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' } });
