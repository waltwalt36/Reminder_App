# Voice Reminder — Mobile (Expo)

Expo Router + TypeScript. Two screens: a mic button and a history list.

Local notifications are scheduled **on the device**; the backend only stores
state. The two are reconciled on every foreground (see "Reconciliation" below).

## Running it

```bash
npm install
npx expo start
```

`.env` holds the backend URL and is gitignored:

```
EXPO_PUBLIC_API_URL=http://192.168.4.43:8000
```

That's this machine's LAN IP, already filled in. It has to be the LAN IP rather
than `localhost` — on a physical device `localhost` is the phone itself. If your
network changes, re-run `ipconfig getifaddr en0` and update it.

Start the backend first: `cd ../backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0`.
The `--host 0.0.0.0` matters — the default binds to loopback only, so the phone
cannot reach it.

### You need a development build, not Expo Go

`expo-notifications` on iOS is too restricted inside Expo Go to trust for this
app, and the microphone permission comes from a config plugin.

```bash
npx expo run:ios          # simulator or a wired device
```

Recording does not work in the iOS **simulator** — it has no microphone input.
Use a real device to exercise the voice path.

## Layout

```
app/
  _layout.tsx      Stack, permissions, notification-response handling, resync
  index.tsx        Home — mic button, next reminder, result banner
  history.tsx      Upcoming + earlier, complete/delete
src/
  api/             Typed client mirroring the backend schema
  audio/           useVoiceCapture — recording + silence detection
  notifications/   Scheduling, category/actions, schedule reconciliation
  components/      MicButton, ResultBanner
```

## The mic button's five states

| State | What you see |
|---|---|
| Idle | Solid circle |
| Listening | Ring pulses with live mic amplitude |
| Thinking | Ring becomes a spinner while the backend transcribes + parses |
| Confirmed | Green card with task + time, auto-dismisses after 2s |
| Unsure | Amber card showing Claude's assumption; stays until dismissed |

**Unsure** triggers below `parse_confidence` 0.7. A low-confidence parse gets a
persistent card naming the assumption ("Assumed 'evening' means 6 PM") instead
of a 2-second toast — a guess you only glimpse is worse than no confirmation.

## Silence detection

`useVoiceCapture` reads `expo-audio` metering (dBFS) every 100ms:

- above **-40 dB** counts as speech
- **1.2s** below that after speech has started stops the recording
- **4s** with no speech at all aborts (an accidental tap)
- **15s** hard cap

No native module, and the same amplitude signal drives the pulsing ring. If this
proves unreliable in noisy rooms, `react-native-vad` swaps in behind this hook
without touching the screens — but it needs a native dep, so it is worth knowing
whether you need it first.

Tuning constants are at the top of [src/audio/useVoiceCapture.ts](src/audio/useVoiceCapture.ts).

## API calls by event

| Event | Call |
|---|---|
| Launch / foreground | `GET /reminders?upcoming=true` → rebuild local schedule |
| Silence detected | `POST /voice` (audio + timezone + device clock) |
| Notification → **Done** | `PATCH /reminders/{id}` `{status:"completed"}` |
| Notification → **Snooze** | `POST /reminders/{id}/snooze` → reschedule at returned `next_fire_at` |
| Notification swiped away | `PATCH /reminders/{id}` `{status:"dismissed"}` |
| History opens / pull-refresh | `GET /reminders?limit=100` |
| Tap ✓ | `PATCH /reminders/{id}` `{status:"completed"}` |
| Tap ✕ | `DELETE /reminders/{id}` |

### `next_fire_at` is the only time field that matters

The backend resolves the snooze rules server-side, so the client never does date
math:

- `pending` → equals `remind_at`
- `snoozed` → equals `snoozed_until`
- `completed` / `dismissed` → **`null`** → cancel the notification, never re-fire

History also uses `null` here to split "upcoming" from "earlier".

### Reconciliation

The OS owns *when* a notification fires; the backend owns *what state* a
reminder is in. Those drift whenever the app is killed, acts offline, or is
mutated from a notification action while backgrounded.

Rather than tracking that drift, `_layout.tsx` wipes and rebuilds the whole
local schedule on every foreground. It is one request, and it makes every one of
those failure modes self-correcting.

## Known constraints

- **Banners can't be forced persistent.** Temporary vs. persistent is a user
  setting (Settings → Notifications → Reminders → Banner Style). Only Critical
  Alerts overrides it, which is the v2 entitlement path.
- **Notifications respect Silent/DND**, as intended. That is iOS's default
  `active` interruption level — no entitlement needed.
- **Mutations while offline are optimistic**, corrected by the next foreground
  resync. There is no retry queue yet.
