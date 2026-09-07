/** Mirrors the backend's ReminderOut schema. */
export type ReminderStatus = 'pending' | 'snoozed' | 'completed' | 'dismissed';

export interface Reminder {
  id: string;
  raw_transcript: string | null;
  task: string;
  /** UTC ISO-8601 with offset. */
  remind_at: string;
  timezone: string;
  status: ReminderStatus;
  snoozed_until: string | null;
  snooze_count: number;
  /** 0-1. Below LOW_CONFIDENCE the parse was a guess worth confirming. */
  parse_confidence: number | null;
  ambiguity_note: string | null;
  /**
   * The only field worth scheduling against — it already resolves the snooze
   * rules. `null` means acknowledged: cancel any pending notification.
   */
  next_fire_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceReminderResponse {
  reminder: Reminder;
  transcript: string;
}

/** Below this, show the parse for confirmation rather than a 2s toast. */
export const LOW_CONFIDENCE = 0.7;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Present on a failed /voice parse: what was actually heard. */
    readonly transcript?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
