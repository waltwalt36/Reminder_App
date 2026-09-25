import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { login } from '../src/api/auth';
import { useTheme } from '../src/theme';

export default function Login() {
  const theme = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await login(username.trim(), password); router.replace('/'); }
    catch (e) { Alert.alert('Could not sign in', e instanceof Error ? e.message : 'Check the API URL and try again.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={[styles.page, { backgroundColor: theme.bg }]}>
    <View style={styles.form}>
      <Text style={[styles.brand, { color: theme.muted }]}>THREAD · CONNECTIONS</Text>
      <Text style={[styles.title, { color: theme.text }]}>Welcome back.</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>Sign in to your personal account.</Text>
      <View style={styles.fields}>
        <TextInput autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={theme.muted} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]} />
        <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={theme.muted} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]} />
      </View>
      <Pressable disabled={busy || !username || !password} onPress={() => void submit()} style={[styles.button, { backgroundColor: theme.accent, opacity: busy || !username || !password ? 0.65 : 1 }]}><Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text></Pressable>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1, justifyContent: 'center', padding: 26 }, form: { gap: 13 }, brand: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2, marginBottom: 5 }, title: { fontSize: 30, fontWeight: '500' }, subtitle: { fontSize: 16, marginBottom: 16 }, fields: { gap: 10 }, input: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 16 }, button: { minHeight: 50, padding: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 7 }, buttonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 } });
