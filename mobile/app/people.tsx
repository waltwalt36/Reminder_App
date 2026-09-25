import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listPeople, Person } from '../src/api/connections';
import { AppBottomNav } from '../src/components/AppBottomNav';
import { useTheme } from '../src/theme';

export default function People() {
  const theme = useTheme();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    try { setPeople(await listPeople()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load people.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const visiblePeople = people.filter((person) => `${person.name} ${person.organization}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <SafeAreaView style={[styles.page, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
    <View style={styles.top}>
      <Text style={[styles.brand, { color: theme.muted }]}>THREAD · CONNECTIONS</Text>
      <Text style={[styles.title, { color: theme.text }]}>People</Text>
    </View>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search people" placeholderTextColor={theme.muted} style={[styles.search, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]} />
    {loading ? <ActivityIndicator color={theme.accent} /> : <FlatList
      style={styles.list}
      data={visiblePeople}
      keyExtractor={(person) => person.id}
      ItemSeparatorComponent={() => <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }} />}
      ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>{error || (query ? 'No matching people.' : 'No connections yet. Capture your first conversation.')}</Text>}
      renderItem={({ item }) => <Link href={{ pathname: '/person/[id]', params: { id: item.id } }} asChild>
        <Pressable style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.name, { color: theme.text }]}>{item.name || 'Unnamed person'}</Text>
            <Text style={{ color: theme.muted }}>{item.organization || 'No organization'}</Text>
          </View>
          {item.active_reminder_count > 0 && <Text style={[styles.followup, { color: theme.accent, backgroundColor: theme.accentSoft }]}>{item.active_reminder_count} due</Text>}
        </Pressable>
      </Link>}
    />}
    <AppBottomNav />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, top: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 12, gap: 6 }, brand: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2 }, title: { fontSize: 28, fontWeight: '500' }, search: { marginHorizontal: 24, marginBottom: 8, borderWidth: 1, borderRadius: 14, padding: 12, fontSize: 16 }, list: { flex: 1 }, row: { minHeight: 76, paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, name: { fontSize: 17, fontWeight: '500' }, followup: { borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, overflow: 'hidden', fontSize: 12 }, empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 30 } });
