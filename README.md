# Connection Notes (V1)

Personal, single-user testing app for remembering professional conversations and following up. Expo captures voice notes and detects end-of-speech locally; Django receives the finished clip, sends it to Deepgram for transcription, then sends only the transcript to Claude for editable extraction. The user reviews the name, organization, summary, transcript, and suggested interval before saving. Raw audio is removed from device cache after processing and is never persisted by the backend.

The Docker/Railway deployment now uses `backend/django_app/`. The earlier FastAPI reminder prototype remains in `backend/app/` as reference code; it is not the deployed API.

## Run locally

### Backend

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r django_app/requirements.txt
cd django_app
export DJANGO_DEBUG=true
export DJANGO_SECRET_KEY='local-development-only'
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/connection_notes'
export DEEPGRAM_API_KEY='…'
export ANTHROPIC_API_KEY='…'
python manage.py migrate
python manage.py create_app_user
python manage.py runserver 0.0.0.0:8000
```

For a quick local-only trial, omit `DATABASE_URL` to use SQLite. Do not use the fallback local key in a deployed environment. Django refuses to start without `DJANGO_SECRET_KEY` when `DJANGO_DEBUG` is false. Create a non-admin test login with `create_app_user`; the API requires JWT authentication and scopes every record to that account.

### Mobile

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start
```

For a physical phone, set `EXPO_PUBLIC_API_URL` to the computer's reachable LAN address or the deployed HTTPS API URL. A phone cannot reach the development computer via its own `localhost`.

## V1 behavior

- Multiple active follow-ups per person are supported.
- The AI suggests an interval (one day by default); it is editable or can be disabled before save.
- “I followed up” creates a timeline event. The default next check-in is three days later; the user can change the interval or skip it.
- Follow-up timeline only; no predictive response timeline.
- A transcript can be deleted while retaining its summary and interaction. Deleting a person removes their timeline and follow-ups.
- Notification permission is requested when saving the first follow-up, not on app launch. Reminders are local OS notifications and the app resynchronizes them from the API when foregrounded.
- Claude and Deepgram credentials live only in backend environment variables; the mobile app stores JWTs in iOS Keychain/Android Keystore through Expo SecureStore.

## Provider and deletion caveat

Deepgram requests set `mip_opt_out=true`; Deepgram states that it does not retain request content for model improvement with that flag, while request metadata can remain in usage logs. Claude receives transcript text, never raw audio, for extraction and optional coaching. The first AI submission discloses this provider flow. Deleting an in-app transcript removes it from the app database, but does not recall content already sent to external providers; provider-side retention policies and exceptions apply.

## Deploy backend to Railway

Use `backend/` as the service root and attach Railway Postgres. Configure `DJANGO_SECRET_KEY`, `ANTHROPIC_API_KEY`, and `DEEPGRAM_API_KEY`; optionally set `DJANGO_ALLOWED_HOSTS` if Railway's public domain auto-detection is unsuitable. `DATABASE_URL` is read from Railway. Migrations and expired-token cleanup run at startup. Use the resulting HTTPS service URL as `EXPO_PUBLIC_API_URL` for an EAS build. Store provider keys and Django secrets in Railway variables, never in the Expo bundle.

See [reminder-app-architecture.md](reminder-app-architecture.md) for the architecture and V1 decisions.
