import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { Reminder } from '../api/types';
import { FollowUpReminder } from '../api/connections';

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

/** Notifications open the app's follow-up screen; follow-up outcomes are recorded there. */
export async function registerCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, []);

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

export async function scheduleConnectionReminder(reminder: FollowUpReminder, personName?: string): Promise<string | null> {
  const fireAt = new Date(reminder.due_at);
  if (!Number.isFinite(fireAt.getTime()) || fireAt.getTime() <= Date.now()) return null;
  return Notifications.scheduleNotificationAsync({
    identifier: reminder.id,
    content: { title: reminder.title, body: personName ? `Follow up with ${personName}` : 'Open your follow-ups to take the next step.', sound: true, categoryIdentifier: CATEGORY_ID, data: { reminderId: reminder.id, personId: reminder.person } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: 'reminders' },
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
  const count = scheduled.filter(Boolean).length;

  const skipped = reminders.length - count;
  console.log(
    `[notif] server sent ${reminders.length}, scheduled ${count}` +
      (skipped > 0 ? ` (skipped ${skipped}: already past or acknowledged)` : ''),
  );
  await logQueue();
  return count;
}

/**
 * Dump what iOS actually holds. This is the ground truth — the app's own state
 * says nothing about whether a notification will really fire.
 */
export async function logQueue(): Promise<void> {
  const perms = await Notifications.getPermissionsAsync();
  console.log(
    `[notif] permission: status=${perms.status} granted=${perms.granted}` +
      ` alert=${perms.ios?.allowsAlert} sound=${perms.ios?.allowsSound}`,
  );

  const queued = await Notifications.getAllScheduledNotificationsAsync();
  console.log(`[notif] iOS has ${queued.length} scheduled:`);
  for (const n of queued) {
    const t = n.trigger as { type?: string; date?: number } | null;
    const when = t?.date ? new Date(t.date).toLocaleString() : JSON.stringify(t);
    console.log(`  • "${n.content.title}" at ${when}`);
  }
}
