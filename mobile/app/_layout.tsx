import { useEffect } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { readTokens } from '../src/api/auth';
import { listFollowUps } from '../src/api/connections';
import { registerCategory, scheduleConnectionReminder } from '../src/notifications';
import { useTheme } from '../src/theme';

async function resync() {
  try {
    const reminders = await listFollowUps();
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Promise.all(reminders.map(item => scheduleConnectionReminder(item, item.person_name)));
  } catch { /* Keep OS notifications already scheduled while offline. */ }
}

export default function RootLayout() {
  const theme = useTheme(); const segments = useSegments();
  useEffect(() => {
    void registerCategory();
    const stateSub = AppState.addEventListener('change', state => { if (state === 'active') void resync(); });
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      if (response.notification.request.content.data?.reminderId) router.push('/reminders');
    });
    const authSub = DeviceEventEmitter.addListener('connection-auth-expired', () => router.replace('/login'));
    return () => { stateSub.remove(); responseSub.remove(); authSub.remove(); };
  }, []);
  useEffect(() => {
    void readTokens().then(tokens => {
      const inLogin = segments[0] === 'login';
      if (!tokens && !inLogin) router.replace('/login');
      else if (tokens && inLogin) router.replace('/');
    });
  }, [segments]);
  return <SafeAreaProvider><StatusBar style="auto" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
    <Stack.Screen name="index" options={{ title: 'Connection notes', animation: 'none' }} />
    <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
    <Stack.Screen name="people" options={{ title: 'People', animation: 'none' }} />
    <Stack.Screen name="reminders" options={{ title: 'Follow-ups', animation: 'none' }} />
    <Stack.Screen name="person/[id]" options={{ title: 'Connection' }} />
  </Stack></SafeAreaProvider>;
}
