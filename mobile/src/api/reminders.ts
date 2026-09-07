import { API_URL, json, request } from './client';
import { ApiError, Reminder, VoiceReminderResponse } from './types';

/** IANA zone of this device, e.g. "America/New_York". */
export const deviceTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

/**
 * The device's wall clock as a naive local string. Sent with every parse so
 * "in 20 minutes" resolves against the user's clock rather than the server's.
 */
export const deviceNow = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * The main path: audio in, scheduled reminder out.
 *
 * Uses XMLHttpRequest rather than fetch. Expo SDK 54+ replaces global fetch
 * with a WinterCG-standard implementation whose FormData only accepts strings,
 * Blobs, or objects exposing bytes() — it rejects React Native's
 * {uri, name, type} file part with "Unsupported FormDataPart implementation".
 * XHR is RN's native upload path, still accepts that shape, and streams the
 * file from disk instead of reading it into JS memory.
 */
export function createFromVoice(audioUri: string): Promise<VoiceReminderResponse> {
  const form = new FormData();
  form.append('file', {
    uri: audioUri,
    name: 'reminder.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('timezone', deviceTimezone());
  form.append('now', deviceNow());

  const url = `${API_URL}/voice`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // Content-Type is deliberately unset: XHR derives it from the FormData,
    // including the multipart boundary the server needs to parse the body.
    xhr.timeout = 45_000;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new ApiError(xhr.status, 'Server returned a malformed response.'));
        }
        return;
      }

      // The /voice endpoint returns {message, transcript} on a failed parse so
      // the app can still show what was heard.
      let message = `Upload failed (${xhr.status})`;
      let transcript: string | undefined;
      try {
        const detail = JSON.parse(xhr.responseText)?.detail;
        if (typeof detail === 'string') message = detail;
        else if (detail) {
          message = detail.message ?? message;
          transcript = detail.transcript;
        }
      } catch {
        /* keep the status-based message */
      }
      reject(new ApiError(xhr.status, message, transcript));
    };

    xhr.onerror = () => {
      console.warn('[api] POST /voice transport error', { url });
      reject(new ApiError(0, `Can't reach ${API_URL}.`));
    };
    xhr.ontimeout = () => reject(new ApiError(0, 'Upload timed out after 45s.'));

    xhr.send(form);
  });
}

export const listReminders = (params: { upcoming?: boolean; limit?: number } = {}) => {
  const query = new URLSearchParams();
  if (params.upcoming) query.set('upcoming', 'true');
  query.set('limit', String(params.limit ?? 100));
  return request<Reminder[]>(`/reminders?${query}`);
};

export const completeReminder = (id: string) =>
  request<Reminder>(`/reminders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });

export const dismissReminder = (id: string) =>
  request<Reminder>(`/reminders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'dismissed' }),
  });

/** Backend computes the new fire time and returns it in `next_fire_at`. */
export const snoozeReminder = (id: string, minutes?: number) =>
  request<Reminder>(`/reminders/${id}/snooze`, json(minutes ? { minutes } : {}));

export const rescheduleReminder = (id: string, remindAtUtcIso: string) =>
  request<Reminder>(`/reminders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remind_at: remindAtUtcIso }),
  });

export const deleteReminder = (id: string) =>
  request<void>(`/reminders/${id}`, { method: 'DELETE' });
