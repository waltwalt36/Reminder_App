import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { completeReminder, dismissReminder, listReminders, snoozeReminder } from '../src/api/reminders';
import {
  ACTION_DONE,
  ACTION_SNOOZE,
  cancelReminder,
  registerCategory,
  requestPermissions,
  scheduleReminder,
  syncSchedule,
} from '../src/notifications';
import { useTheme } from '../src/theme';

/**
 * Rebuild the local schedule from the server.
 *
 * The OS owns *when* a notification fires; the backend owns *what state* the
 * reminder is in. Those drift whenever the app is killed, offline, or mutated
 * from a notification action. Re-syncing on every foreground makes that
 * self-healing instead of something to reason about.
 */
async function resync() {
  try {
    await syncSchedule(await listReminders({ upcoming: true }));
  } catch {
    // Offline: keep whatever the OS already has scheduled.
  }
}

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    void (async () => {
      await requestPermissions();
      await registerCategory();
      await resync();
    })();

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void resync();
    });

    // Done / Snooze / swipe-away all land here, including while backgrounded.
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        void (async () => {
          const id = response.notification.request.content.data?.reminderId as
            | string
            | undefined;
          if (!id) return;

          try {
            if (response.actionIdentifier === ACTION_SNOOZE) {
              // The backend computes the new time; the client never does snooze math.
              await scheduleReminder(await snoozeReminder(id));
            } else if (response.actionIdentifier === ACTION_DONE) {
              await completeReminder(id);
              await cancelReminder(id);
            } else if (
              response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
            ) {
              // Opened the app rather than acting — leave the state alone.
            } else {
              // Swiped away (reported because the category sets customDismissAction).
              await dismissReminder(id);
              await cancelReminder(id);
            }
          } catch {
            // Offline: the next foreground resync reconciles with the server.
          }
        })();
      },
    );

    return () => {
      appStateSub.remove();
      responseSub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Reminders' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
