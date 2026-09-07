import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { Reminder } from '../api/types';

export const CATEGORY_ID = 'reminder';
export const ACTION_DONE = 'done';
export const ACTION_SNOOZE = 'snooze';

/** Foreground presentation: banner + sound, matching the fired-in-background feel. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestPermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const { granted } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return granted;
}

/**
 * Registers the Done / Snooze buttons.
 *
 * `customDismissAction` is what makes iOS report a swipe-away; without it a
 * dismissed reminder would look untouched to the backend.
 */
export async function registerCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(
    CATEGORY_ID,
    [
      { identifier: ACTION_DONE, buttonTitle: 'Done' },
      { identifier: ACTION_SNOOZE, buttonTitle: 'Snooze 5 min' },
    ],
    { customDismissAction: true },
  );

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

/**
 * Schedules one reminder. No-op when `next_fire_at` is null (acknowledged) or
 * already past — iOS accepts a past date and then silently never fires.
 */
export async function scheduleReminder(reminder: Reminder): Promise<string | null> {
  if (!reminder.next_fire_at) return null;

  const fireAt = new Date(reminder.next_fire_at);
  if (fireAt.getTime() <= Date.now()) return null;

  return Notifications.scheduleNotificationAsync({
    identifier: reminder.id, // reuse the reminder id so rescheduling replaces cleanly
    content: {
      title: reminder.task,
      body: 'Tap to open, or swipe for options.',
      sound: true,
      categoryIdentifier: CATEGORY_ID,
      data: { reminderId: reminder.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: 'reminders',
    },
  });
}

export const cancelReminder = (id: string) =>
  Notifications.cancelScheduledNotificationAsync(id).catch(() => {
    // Already fired or never scheduled — nothing to cancel.
  });

/**
 * Rebuilds the entire local schedule from the server's list.
 *
 * The OS holds the scheduled notifications and the backend holds the state;
 * those drift whenever the app was killed, offline, or mutated elsewhere.
 * Wiping and re-scheduling on every foreground is cheap and makes every such
 * drift self-healing.
 */
export async function syncSchedule(reminders: Reminder[]): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const scheduled = await Promise.all(reminders.map(scheduleReminder));
  return scheduled.filter(Boolean).length;
}
