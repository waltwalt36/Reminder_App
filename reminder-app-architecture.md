# Voice Reminder App — Architecture v1

## Overview
Voice-first reminder app. User holds a button, speaks a reminder, app parses it into a task + time, schedules a high-priority local notification, and stores it in a persistent history.

---

## 1. Frontend (React Native)

**Screens:**
- **Home** — big mic button (tap to start, auto-detects when user is done speaking), shows current/upcoming reminder if one's active
- **History** — sidebar/tab listing past + upcoming reminders (task, time, status: pending / completed / dismissed)

**Flow on the device:**
1. User taps mic button → recording starts, transcription runs continuously/on stop
2. App detects end of speech (silence detection) → stops recording automatically
3. Send audio (or transcript, depending on where transcription happens) to backend for parsing
4. Show parsed result as a brief confirmation — small popup/toast (~2 seconds), e.g. "Reminder set: walk the dog at 6:30 PM"
5. Schedule local notification via OS notification API (this is a **device-side** action, not backend — the backend just stores the record)

**Notifications:**
- v1: high-priority local notification, custom sound, `interruptionLevel` set appropriately, requires tap to dismiss
- v2 (later): Apple Critical Alerts entitlement, once approved

---

## 2. Backend (FastAPI, on Railway)

**Responsibilities:**
- Receive audio or transcribed text
- Call transcription model (if not done on-device)
- Call Claude to parse text → structured `{task, datetime}`
- Store reminder in Postgres
- Serve CRUD endpoints for the app to read history

**Endpoints (rough):**
| Method | Route | Purpose |
|---|---|---|
| POST | `/reminders` | Create reminder from parsed voice input |
| GET | `/reminders` | List all reminders (history) |
| GET | `/reminders/{id}` | Get one reminder |
| PATCH | `/reminders/{id}` | Update status (completed/dismissed) |
| DELETE | `/reminders/{id}` | Delete a reminder |
| POST | `/parse` | (optional, separate from create) raw text → structured task+time, useful for testing the parsing in isolation |

Async handlers throughout since most of the work here is waiting on the Claude API call, not local computation.

---

## 3. Database (Postgres)

**`reminders` table (rough columns):**
| Column | Type | Notes |
|---|---|---|
| id | UUID / serial | primary key |
| raw_transcript | text | what the user actually said |
| task | text | parsed task description |
| remind_at | timestamptz | parsed target time |
| status | enum | `pending`, `completed`, `dismissed` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Keep it to one table for v1 — no need for users/auth tables yet if this is just for you.

---

## 4. AI Layer

- **Transcription:** backend call to start (simpler to build, better accuracy, small per-use cost). Revisit on-device later if cost or offline reliability becomes a real problem — see trade-offs below.
- **Parsing (text → structured reminder):** Claude Haiku via API for now — cheap, reliable, easy to iterate on prompts. This is the piece most worth testing thoroughly since it's the core value prop.

---

## 5. Deployment

- **Backend:** Railway (you've used it before — straightforward)
- **Frontend:** Expo build → TestFlight (iOS) for personal/beta use before full App Store submission
- **Scaling path (later):** Railway → AWS if/when usage grows, on-device model for parsing to cut per-user API cost if you ship publicly

---

## 6. Recording Cutoff: Voice Activity Detection (VAD)

Silence detection (deciding when the user is "done talking") is a separate concern from transcription itself — worth keeping distinct:

- **Recording** — raw audio capture, no intelligence
- **VAD** — a small, fast, on-device model that only answers "is speech happening right now, or silence?" Doesn't know *what* was said, just *whether* something is being said. Its only job is telling the app when to stop recording.
- **Transcription** — converts the finished audio clip into text. In v1, this happens as a backend call (see below), not on-device.

**Flow:** tap mic → recording starts + VAD runs in parallel on-device → VAD detects ~1–1.5 sec of silence → recording stops → finished clip sent to backend → backend transcribes → Claude parses into task+time → confirmation shown.

**Options for silence detection:**
| Approach | Control | Setup effort | Notes |
|---|---|---|---|
| Native OS speech APIs (wrapped via e.g. react-native-voice) | Low — mostly fixed OS behavior | Low | Silence handling built in but not very tunable |
| Dedicated VAD package (e.g. react-native-vad) | High — tunable thresholds/duration | Medium | Runs separately from transcription; only used for stop-detection. **Recommended for v1** — pairs well with backend transcription, avoids sending dead air |
| Full on-device Whisper w/ VAD gating (e.g. whisper.rn, nitro-voice) | High | High | Bundles model files, runs entirely offline — overkill for v1 since transcription is happening on the backend anyway |

## 7. Transcription: On-Device vs Backend Call — Trade-offs

**On-device from day one:**
- No network dependency, works offline, zero marginal cost per use
- Faster response, no round trip
- Limited to smaller models (Whisper tiny/small, native OS speech APIs) — accuracy can dip with noise or unusual phrasing
- More upfront work — native speech API integration on both iOS and Android
- Harder to iterate/improve later

**Backend call to start (chosen for v1):**
- Simple to build — record, POST, get text back
- Better accuracy out of the gate (can call a strong cloud model)
- Small per-use cost, small added latency
- Requires internet
- Easy to migrate to on-device later since it's just swapping the call, not a rewrite

---

## 8. Decisions Locked In
- Recording: tap to start, auto-stop on silence detection (not hold-to-talk)
- Confirmation: brief popup/toast (~2 sec) showing parsed task + time before/as reminder is set
- Time storage: UTC in the database, converted to local time on device for display
- Transcription: backend call for v1
- Recording cutoff: dedicated VAD package for silence detection, transcription still handled by backend
