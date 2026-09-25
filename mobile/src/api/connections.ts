import { api, uploadVoice } from './connectionClient';

export type FollowUpState = 'scheduled' | 'snoozed' | 'completed' | 'cancelled';
export interface FollowUpReminder {
  id: string; person: string; person_name?: string; interaction: string | null; title: string; due_at: string;
  status: FollowUpState; created_by: string; completed_at: string | null; created_at: string;
}
export interface Interaction {
  id: string; kind: string; occurred_at: string | null; transcript: string; summary: string;
  source: 'voice' | 'text' | 'user'; created_at: string; reminders: FollowUpReminder[];
}
export interface Person {
  id: string; name: string; organization: string; relationship_state: string;
  created_at: string; updated_at: string; interactions: Interaction[]; reminders: FollowUpReminder[];
  active_reminder_count: number;
}
export interface CaptureDraft {
  transcript: string; source: 'voice' | 'text'; name: string; organization: string; summary: string;
  occurred_at: string | null; suggested_followup_days: number; follow_up_at?: string | null;
}

export const captureVoice = (uri: string) => uploadVoice('/capture/', uri, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') as Promise<CaptureDraft>;
export const captureText = (text: string) => api<CaptureDraft>('/capture/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }) });
export const saveCapture = (draft: CaptureDraft, values: Partial<CaptureDraft> & { person_id?: string; follow_up_title?: string }) => api<Person>('/capture/save/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...values }) });
export const listPeople = () => api<Person[]>('/people/');
export const getPerson = (id: string) => api<Person>(`/people/${id}/`);
export const deletePerson = (id: string) => api<void>(`/people/${id}/`, { method: 'DELETE' });
export const listFollowUps = () => api<FollowUpReminder[]>('/reminders/?active=true');
export const editFollowUp = (id: string, values: Partial<Pick<FollowUpReminder, 'title' | 'due_at' | 'status'>>) => api<FollowUpReminder>(`/reminders/${id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
export const markFollowedUp = (id: string, note: string, nextAt: string | null) => api<{ reminder: FollowUpReminder; person: Person }>(`/reminders/${id}/followed-up/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note, next_reminder_at: nextAt, next_reminder_title: 'Check in' }) });
export const getCoaching = (personId: string) => api<{ suggestion: string }>(`/people/${personId}/coach/`, { method: 'POST' });
export const deleteTranscript = (interactionId: string) => api<void>(`/interactions/${interactionId}/transcript/`, { method: 'DELETE' });
export const deleteInteraction = (interactionId: string) => api<void>(`/interactions/${interactionId}/`, { method: 'DELETE' });
