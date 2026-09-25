# Connection Notes — V1 architecture

## Product scope

A single-user personal-testing app for keeping a lightweight memory of people met at networking events and managing follow-ups. The primary workflow is: capture a conversation note, review AI-extracted fields, save the interaction, then act on a local follow-up reminder. A person can have multiple active reminders. V1 stores a follow-up timeline only; it does not infer reply timing or create a predictive response timeline.

## Mobile app

Expo Router / React Native. Screens include:

- Capture: Expo Audio recording, current room-relative silence/end-of-speech detection, optional typed note, editable review form, suggested follow-up interval, save or discard.
- People: searchable-ready list and person timeline with transcript deletion and full person deletion.
- Follow-ups: active reminders, mark followed up, optionally create a next check-in, or record no action.
- Connection detail: notes, reminder context, and an optional Claude-generated next-step suggestion.
- Sign-in: JWT-based personal account authentication.

Expo Audio writes the recording into app cache. The completed clip is uploaded once, then deleted from cache whether transcription succeeds or fails; no raw audio is stored in Django/Postgres. Expo Notifications schedules local notifications. Permission is requested in context when the user first saves a reminder. The app refreshes local schedules from active API reminders when foregrounded.

Dates are represented as instants in UTC on the API/database. The client computes interval suggestions in local calendar days before converting to ISO UTC, preserving the user's local clock time across ordinary date changes.

## Backend and API

Django 5.2, Django REST Framework, SimpleJWT, and PostgreSQL. Railway runs the Django WSGI app; migrations run at startup. SQLite is permitted for a simple local trial. Each record is owned by an authenticated Django user even though V1 is intended for one personal tester. Access tokens last 30 minutes; rotating refresh tokens last 14 days and are blacklisted after rotation.

Main endpoints under `/api/`:

| Endpoint | Purpose |
|---|---|
| `POST auth/token/`, `POST auth/refresh/`, `POST auth/logout/` | Login and token lifecycle |
| `POST capture/` | Audio upload or text note; transcribe if audio, extract editable fields |
| `POST capture/save/` | Save reviewed interaction and optional initial reminder atomically |
| `GET people/`, `GET/PATCH/DELETE people/{id}/` | List and manage people |
| `POST people/{id}/coach/` | Optional contextual next-step suggestion |
| `GET reminders/?active=true`, `POST reminders/` | List/create follow-ups |
| `PATCH/DELETE reminders/{id}/`, `POST reminders/{id}/followed-up/` | Manage or complete follow-ups |
| `DELETE interactions/{id}/transcript/`, `DELETE interactions/{id}/` | Delete transcript or interaction |

## Transcription and AI boundary

1. Expo Audio records and detects silence locally; no cloud audio stream is used.
2. Mobile uploads one completed audio file to the authenticated Django API.
3. Django calls Deepgram Nova for transcription with `mip_opt_out=true` and receives the transcript.
4. Django sends transcript text to Claude for structured extraction. Claude does not receive raw audio.
5. Mobile receives a draft, user edits/reviews it, then explicitly saves it.
6. On backend failure, transcript remains available in the draft for manual completion where possible; audio is still deleted locally.

Provider credentials are server-only environment variables. The mobile binary contains only the backend URL and uses JWT tokens held by Expo SecureStore. Do not ship Deepgram or Anthropic API keys in `EXPO_PUBLIC_*` variables or the app bundle.

The app displays a first-use provider disclosure. Deepgram's content-retention opt-out does not mean all request metadata is erased. Deleting a transcript in the app removes its database text but cannot recall already-submitted provider requests. Provider terms and retention exceptions can change and should be rechecked before wider release.

## Data model

- `Person`: owner, name, organization, relationship state, timestamps.
- `Interaction`: person, kind, date, original transcript (optional/deletable), factual summary, source.
- `FollowUpReminder`: person, optional originating interaction, title, due time, lifecycle status, creation source.

Deleting a person cascades through its interactions and reminders. Deleting one interaction cancels active reminders attached to it. Deleting only a transcript retains the summary and timeline event.

## V1 decisions

- Backend: Django; database: PostgreSQL.
- Single-user/personal testing, with normal account authentication and record ownership.
- Voice: existing Expo Audio recording and custom silence logic; Deepgram transcription; no raw audio persistence.
- Claude handles text extraction and optional coaching, never audio transcription.
- Initial follow-up default: one day; AI suggestion can vary with explicit timing and is editable or removable.
- After “I followed up”: suggest a check-in after three days; user can change the interval or skip.
- Reminder delivery: local OS notifications; permission is requested at first reminder save.
- Transcript deletion: user can erase transcript while retaining the summary. The UI explains provider-side caveat.
- No response-speed-based forecast in V1.
