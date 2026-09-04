# Voice Reminder — Backend

FastAPI + Postgres. Takes a recorded clip, transcribes it, parses it into a task
and a time with Claude, and stores the record the device schedules its
notification against.

The backend never sends a notification. Firing is a device-side concern (§1 of
the architecture doc); this service owns parsing and state.

## Quick start

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # fill in ANTHROPIC_API_KEY and a transcription key

createdb reminders_dev
DATABASE_URL="postgresql://$(whoami)@localhost:5432/reminders_dev" .venv/bin/alembic upgrade head

.venv/bin/uvicorn app.main:app --reload
```

Interactive API docs at `http://localhost:8000/docs`.

Set `TRANSCRIPTION_PROVIDER=stub` to exercise the whole pipeline without a
speech-to-text vendor key — it returns a canned transcript.

## Tests

```bash
.venv/bin/python -m pytest
```

34 tests, no network, no database required — they run against in-memory SQLite
with the Claude call stubbed.

## Iterating on the parse prompt

Parsing is the core of the product, so it has its own harness. It hits the real
API (a fraction of a cent per run on Haiku):

```bash
.venv/bin/python scripts/eval_parser.py
.venv/bin/python scripts/eval_parser.py "remind me to stretch in 10"
```

It runs 20 realistic utterances covering explicit times, relative offsets,
parts of day, days of week, and deliberately vague requests. Three kinds of case:

- **Pinned-clock (5)** — the case supplies its own `now`, so there is exactly
  one right answer regardless of when you run it. These cover the roll-forward
  rules ("at noon" said in the afternoon means *tomorrow* noon) and a
  DST-boundary conversion. Without pinning, these only get exercised by accident
  depending on the hour.
- **Ambiguous (3)** — no correct time exists for "remind me about that later".
  The check is that Claude reports low confidence rather than inventing
  certainty.
- **The rest** — must parse into a future time without erroring.

Last run: **20/20** on `claude-haiku-4-5`.

The prompt itself is `build_system_prompt` in [app/services/parser.py](app/services/parser.py).

## API

| Method | Route | Purpose |
|---|---|---|
| POST | `/voice` | **Main path.** multipart audio + timezone → transcribe → parse → store |
| POST | `/parse` | Text → structured task+time. Persists nothing; for testing the prompt |
| POST | `/reminders` | Create from an already-parsed task + time |
| GET | `/reminders` | History. `?upcoming=true` for the Home screen, `?status=` to filter |
| GET | `/reminders/{id}` | One reminder |
| PATCH | `/reminders/{id}` | Edit task/time, or set status to `completed` / `dismissed` |
| POST | `/reminders/{id}/snooze` | Re-fire in N minutes (default 5) |
| DELETE | `/reminders/{id}` | Delete |
| GET | `/healthz` | Liveness + active model/provider |

### The field the app actually schedules against

`next_fire_at` is the one to read. It resolves the snooze rules for you:

- `pending` → equals `remind_at`
- `snoozed` → equals `snoozed_until`
- `completed` / `dismissed` → **`null`**, meaning never fire again

A `null` here is the signal to cancel any pending `UNNotificationRequest` on the
device. Per the v1 rules, an acknowledged reminder does not come back.

### Time handling

Every instant in a response is UTC with an explicit offset (`...Z`). The device
converts for display. `remind_at_local` on `/parse` responses is the one
deliberate exception — it is naive wall-clock in the user's zone, useful for
rendering the confirmation toast without a second conversion.

Send `timezone` (IANA, e.g. `America/New_York`) with every parse, and send `now`
(the device's wall clock) too. Without `now`, "in 20 minutes" resolves against
the server's clock rather than the user's.

## Configuration

See [.env.example](.env.example). The two that matter:

- `PARSER_MODEL` — defaults to `claude-haiku-4-5`. If parse accuracy
  disappoints on messier phrasing, `claude-sonnet-5` is a one-variable swap.
- `TRANSCRIPTION_PROVIDER` — `deepgram` | `groq` | `openai` | `stub`.

### Swapping transcription providers

Every provider implements `Transcriber` in
[app/services/transcription/base.py](app/services/transcription/base.py). Adding
one is a new module plus a line in the registry; switching is an env var. This
is also the seam for moving transcription on-device later (§7) — the app would
stop calling `/voice` and start calling `/reminders` with a transcript it
produced itself, which the API already supports.

## Deploying to Railway

1. New project → Deploy from repo, root directory `backend/`.
2. Add the Postgres plugin. It injects `DATABASE_URL` automatically; the app
   rewrites the scheme for asyncpg.
3. Set `ANTHROPIC_API_KEY`, `TRANSCRIPTION_PROVIDER`, and the matching vendor key.
4. Deploy. Migrations run on boot, so the schema is never behind the code.

Health check is wired to `/healthz` in [railway.json](railway.json).
