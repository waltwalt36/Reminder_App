import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { logout } from '../src/api/auth';

import { CaptureDraft, captureText, captureVoice, listFollowUps, listPeople, saveCapture, FollowUpReminder } from '../src/api/connections';
import { readTokens } from '../src/api/auth';
import { useVoiceCapture } from '../src/audio/useVoiceCapture';
import { MicButton } from '../src/components/MicButton';
import { AppBottomNav } from '../src/components/AppBottomNav';
import { requestPermissions, scheduleConnectionReminder } from '../src/notifications';
import { useTheme } from '../src/theme';

const localDaysFromNow = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString();
};

async function ensureAiDisclosure(): Promise<boolean> {
  if (await SecureStore.getItemAsync('connection-ai-disclosure-v1')) return true;
  const accepted = await new Promise<boolean>((resolve) => Alert.alert('Your note is processed securely', 'Typed notes go to Claude to organize into editable fields. If you record a note, audio is sent to Deepgram with content-retention opt-out enabled, and the transcript then goes to Claude. The app saves the transcript only when you save the note; raw audio is deleted from this device after processing. Provider-side retention terms may change and provider metadata may still be retained.', [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Continue', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
  if (accepted) await SecureStore.setItemAsync('connection-ai-disclosure-v1', 'shown');
  return accepted;
}

export default function Home() {
  const theme = useTheme();
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [summary, setSummary] = useState('');
  const [transcript, setTranscript] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [followUp, setFollowUp] = useState(true);
  const [followUpDays, setFollowUpDays] = useState('1');
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<FollowUpReminder | null>(null);
  const [typedNote, setTypedNote] = useState('');
  const [showTypedNote, setShowTypedNote] = useState(false);
  const [linkExisting, setLinkExisting] = useState(false);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeople>>>([]);
  const [personId, setPersonId] = useState<string | undefined>();

  useFocusEffect(useCallback(() => {
    void readTokens().then((value) => { if (!value) router.replace('/login'); });
    void listFollowUps().then((items) => setNext(items[0] ?? null)).catch(() => {});
  }, []));

  const acceptDraft = (value: CaptureDraft) => {
    setPersonId(undefined);
    setLinkExisting(false);
    setDraft(value); setName(value.name ?? ''); setOrganization(value.organization ?? '');
    setSummary(value.summary ?? ''); setTranscript(value.transcript ?? ''); setOccurredAt(value.occurred_at ?? ''); setFollowUpDays(String(value.suggested_followup_days || 1));
  };

  const toggleExisting = async () => {
    if (!linkExisting) {
      try { setPeople(await listPeople()); setLinkExisting(true); }
      catch (e) { Alert.alert('Could not load people', e instanceof Error ? e.message : 'Try again.'); }
    } else { setLinkExisting(false); setPersonId(undefined); setName(draft?.name ?? ''); setOrganization(draft?.organization ?? ''); }
  };

  const processVoice = useCallback(async (uri: string) => {
    setBusy(true);
    try {
      if (!(await ensureAiDisclosure())) return;
      acceptDraft(await captureVoice(uri));
    } catch (e) { Alert.alert('Could not process note', e instanceof Error ? e.message : 'Please try again.'); }
    finally { try { new File(uri).delete(); } catch {} setBusy(false); }
  }, []);

  const { state, level, start, stop } = useVoiceCapture({
    onResult: processVoice,
    onError: (message) => Alert.alert('Recording', message),
  });

  const typeNote = async () => {
    if (!typedNote.trim()) { setShowTypedNote(true); return; }
    setBusy(true);
    try { if (!(await ensureAiDisclosure())) return; acceptDraft(await captureText(typedNote.trim())); setTypedNote(''); setShowTypedNote(false); }
    catch (e) { Alert.alert('Could not organize note', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft || !name.trim()) { Alert.alert('Add a name', 'Enter a name before saving this connection.'); return; }
    setBusy(true);
    try {
      const person = await saveCapture(draft, { person_id: personId, name, organization, summary, transcript,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
        follow_up_at: followUp ? localDaysFromNow(Math.max(1, Math.min(30, Number.parseInt(followUpDays, 10) || 1))) : null, follow_up_title: 'Follow up' });
      if (person.reminders.some((r) => r.status === 'scheduled')) {
        if (await requestPermissions()) {
          const active = await listFollowUps();
          await Promise.all(active.map((reminder) => scheduleConnectionReminder(reminder, reminder.person_name)));
        } else {
          Alert.alert('Follow-up saved', 'Notifications are turned off for this app. You can still find this follow-up in the Follow-ups screen and enable notifications in device settings.');
        }
      }
      setDraft(null); setFollowUp(true); setTranscript(''); setOccurredAt('');
      Alert.alert('Saved', `${person.name} is in your connections.`);
    } catch (e) { Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const formattedOccurredAt = occurredAt ? new Date(occurredAt).toLocaleString() : '';
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {draft ? <>
        <View style={styles.headingBlock}><Text style={[styles.brand, { color: theme.muted }]}>REVIEW NOTE</Text><Text style={[styles.title, { color: theme.text }]}>Did we get this right?</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Edit anything before saving.</Text></View>
        <View style={styles.fields}>
          <Text style={[styles.label, { color: theme.muted }]}>PERSON</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Person's name" placeholderTextColor={theme.muted} style={[styles.lineInput, { color: theme.text, borderColor: theme.border }]} />
          <TextInput value={organization} onChangeText={setOrganization} placeholder="Company or organization" placeholderTextColor={theme.muted} style={[styles.lineInput, { color: theme.text, borderColor: theme.border }]} />
          <Text style={[styles.helper, { color: theme.muted }]}>Name and company are suggestions. Check them before saving.</Text>
          <Text style={[styles.label, { color: theme.muted }]}>WHEN</Text>
          <TextInput value={formattedOccurredAt} onChangeText={setOccurredAt} placeholder="Today · change date or time" placeholderTextColor={theme.muted} style={[styles.lineInput, { color: theme.text, borderColor: theme.border }]} />
          <Text style={[styles.label, { color: theme.muted }]}>WHAT YOU DISCUSSED</Text>
          <TextInput value={summary} onChangeText={setSummary} multiline placeholder="Conversation notes" placeholderTextColor={theme.muted} style={[styles.lineInput, styles.multiline, { color: theme.text, borderColor: theme.border }]} />
          <Text style={[styles.label, { color: theme.muted }]}>TRANSCRIPT</Text>
          <TextInput value={transcript} onChangeText={setTranscript} multiline placeholder="Transcript" placeholderTextColor={theme.muted} style={[styles.lineInput, styles.multiline, { color: theme.text, borderColor: theme.border }]} />
          <Pressable onPress={() => void toggleExisting()}><Text style={{ color: theme.accent }}>{linkExisting ? 'Create a new person instead' : 'Add this note to an existing person'}</Text></Pressable>
          {linkExisting && <View style={{ gap: 6 }}>{people.map(person => <Pressable key={person.id} onPress={() => { setPersonId(person.id); setName(person.name); setOrganization(person.organization); }} style={[styles.personChoice, { borderColor: theme.border, backgroundColor: personId === person.id ? theme.accentSoft : theme.card }]}><Text style={{ color: theme.text, fontWeight: '600' }}>{person.name}</Text><Text style={{ color: theme.muted }}>{person.organization}</Text></Pressable>)}</View>}
          <Text style={[styles.label, { color: theme.muted }]}>FOLLOW-UP</Text>
          <Pressable onPress={() => setFollowUp(!followUp)} style={styles.check}><Text style={{ color: theme.accent, fontSize: 18 }}>{followUp ? '☑' : '□'}</Text><Text style={{ color: theme.text }}>{followUp ? `Follow up in ${followUpDays || 1} day${followUpDays === '1' ? '' : 's'}` : 'No follow-up reminder'}</Text></Pressable>
          {followUp && <View style={styles.interval}><Text style={{ color: theme.muted }}>AI suggestion · edit timing</Text><TextInput keyboardType="number-pad" value={followUpDays} onChangeText={setFollowUpDays} style={[styles.days, { color: theme.text, borderColor: theme.border }]} /></View>}
        </View>
        <Pressable disabled={busy} onPress={() => void save()} style={[styles.primary, { backgroundColor: theme.accent }]}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save connection'}</Text></Pressable>
        <Pressable onPress={() => setDraft(null)}><Text style={[styles.cancel, { color: theme.muted }]}>Keep editing later</Text></Pressable>
      </> : <>
        <View style={styles.headingBlock}><View style={styles.brandRow}><Text style={[styles.brand, { color: theme.muted }]}>THREAD · CONNECTIONS</Text><Pressable onPress={() => void logout().then(async () => { const Notifications = await import('expo-notifications'); await Notifications.cancelAllScheduledNotificationsAsync(); router.replace('/login'); })}><Text style={[styles.signOut, { color: theme.muted }]}>Log out</Text></Pressable></View><Text style={[styles.title, { color: theme.text }]}>Save the conversation{'\n'}while it’s fresh.</Text><Text style={[styles.subtitle, { color: theme.muted }]}>A quick voice note is enough.</Text></View>
        <View style={styles.capture}><MicButton state={busy ? 'thinking' : state} level={level} onPress={state === 'listening' ? stop : start} interactive={false} /><Text style={[styles.hint, { color: theme.muted }]}>Tap to start. Tell us who you met and one thing you want to remember.</Text><Pressable disabled={busy} onPress={state === 'listening' ? stop : start} style={[styles.primary, { backgroundColor: theme.accent }]}><Text style={styles.primaryText}>{state === 'listening' ? 'Stop recording' : busy ? 'Working…' : 'Start voice note'}</Text></Pressable><Pressable onPress={() => setShowTypedNote(!showTypedNote)} style={[styles.secondary, { backgroundColor: theme.accentSoft }]}><Text style={[styles.secondaryText, { color: theme.text }]}>Type a note instead</Text></Pressable>
          {showTypedNote && <View style={{ width: '100%', gap: 10, marginTop: 10 }}><TextInput value={typedNote} onChangeText={setTypedNote} multiline placeholder="What do you want to remember?" placeholderTextColor={theme.muted} style={[styles.lineInput, styles.multiline, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]} /><Pressable onPress={() => void typeNote()} style={[styles.primary, { backgroundColor: theme.accent }]}><Text style={styles.primaryText}>Continue</Text></Pressable></View>}
        </View>
        {next && <Pressable onPress={() => router.push('/reminders')} style={styles.upNext}><Text style={[styles.label, { color: theme.muted }]}>NEXT FOLLOW-UP</Text><Text style={{ color: theme.text, fontWeight: '600' }}>{next.person_name}: {next.title}</Text><Text style={{ color: theme.muted }}>{new Date(next.due_at).toLocaleString()}</Text></Pressable>}
      </>}
    </ScrollView>
    <AppBottomNav />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18, gap: 18 }, headingBlock: { gap: 7 }, brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2 }, signOut: { fontSize: 13 }, title: { fontSize: 29, lineHeight: 35, fontWeight: '500', marginTop: 4 }, subtitle: { fontSize: 16 }, fields: { gap: 8 }, label: { fontSize: 13, fontWeight: '500', letterSpacing: 0.3, marginTop: 12 }, helper: { fontSize: 13, marginBottom: 4 }, lineInput: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 0, paddingVertical: 11, fontSize: 16 }, multiline: { minHeight: 68, textAlignVertical: 'top' }, check: { flexDirection: 'row', gap: 10, alignItems: 'center', marginVertical: 4 }, interval: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, days: { width: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#AAB6B1', padding: 8, textAlign: 'center', fontSize: 16 }, personChoice: { borderWidth: 1, borderRadius: 9, padding: 10, flexDirection: 'row', justifyContent: 'space-between' }, primary: { minHeight: 48, width: '100%', padding: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' }, secondary: { minHeight: 48, padding: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', width: '100%' }, secondaryText: { fontSize: 15, fontWeight: '500' }, cancel: { textAlign: 'center', padding: 8 }, capture: { flexGrow: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', gap: 20 }, hint: { textAlign: 'center', maxWidth: 280, fontSize: 15, lineHeight: 22 }, upNext: { paddingVertical: 10, gap: 5 } });
