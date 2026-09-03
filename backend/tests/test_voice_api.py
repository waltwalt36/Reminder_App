"""Covers the app's primary path: audio in, scheduled reminder out.

Transcription uses the stub provider; the Claude call is replaced so the test
stays offline and deterministic.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.schemas import ParseResult
from app.services.parser import ParseError
from app.services.transcription.stub import STUB_TRANSCRIPT

TZ = "America/New_York"


@pytest.fixture
def fake_parse(monkeypatch):
    """Install a stand-in for the Claude call. Returns a recorder of its args."""
    calls = []

    def install(result=None, error=None):
        async def _parse(text, tz_name, now_local=None):
            calls.append({"text": text, "tz": tz_name, "now": now_local})
            if error is not None:
                raise error
            return result

        monkeypatch.setattr("app.routers.voice.parse_reminder", _parse)
        return calls

    return install


def parsed(task="Walk the dog", minutes_ahead=120, confidence=0.95, note=None) -> ParseResult:
    local = datetime.now(ZoneInfo(TZ)) + timedelta(minutes=minutes_ahead)
    return ParseResult(
        task=task,
        remind_at=local.astimezone(UTC),
        remind_at_local=local.replace(tzinfo=None),
        timezone=TZ,
        confidence=confidence,
        ambiguity_note=note,
    )


def audio_files(data: bytes = b"fake-m4a-bytes"):
    return {"file": ("clip.m4a", data, "audio/m4a")}


async def test_voice_creates_a_pending_reminder(client, fake_parse):
    fake_parse(result=parsed())

    response = await client.post(
        "/voice", files=audio_files(), data={"timezone": TZ}
    )

    assert response.status_code == 201, response.text
    body = response.json()

    assert body["transcript"] == STUB_TRANSCRIPT
    assert body["reminder"]["task"] == "Walk the dog"
    assert body["reminder"]["status"] == "pending"
    assert body["reminder"]["raw_transcript"] == STUB_TRANSCRIPT
    assert body["reminder"]["parse_confidence"] == 0.95
    assert body["reminder"]["next_fire_at"] == body["reminder"]["remind_at"]


async def test_voice_reminder_is_persisted_and_listed(client, fake_parse):
    fake_parse(result=parsed())

    created = (await client.post("/voice", files=audio_files(), data={"timezone": TZ})).json()

    listed = (await client.get("/reminders", params={"upcoming": True})).json()
    assert [r["id"] for r in listed] == [created["reminder"]["id"]]


async def test_transcript_is_handed_to_the_parser_with_the_device_clock(client, fake_parse):
    calls = fake_parse(result=parsed())
    device_now = "2026-09-02T14:00:00"

    await client.post(
        "/voice", files=audio_files(), data={"timezone": TZ, "now": device_now}
    )

    assert calls[0]["text"] == STUB_TRANSCRIPT
    assert calls[0]["tz"] == TZ
    # Relative phrases must resolve against the user's clock, not the server's.
    assert calls[0]["now"] == datetime(2026, 9, 2, 14, 0, 0)


async def test_low_confidence_parse_is_surfaced_not_hidden(client, fake_parse):
    """The app needs this to decide whether the toast offers an edit affordance."""
    fake_parse(result=parsed(confidence=0.3, note="No time was stated; assumed one hour from now."))

    body = (await client.post("/voice", files=audio_files(), data={"timezone": TZ})).json()

    assert body["reminder"]["parse_confidence"] == 0.3
    assert "assumed one hour" in body["reminder"]["ambiguity_note"].lower()


async def test_failed_parse_returns_422_with_the_transcript(client, fake_parse):
    fake_parse(error=ParseError("parsed time is in the past"))

    response = await client.post("/voice", files=audio_files(), data={"timezone": TZ})

    assert response.status_code == 422
    detail = response.json()["detail"]
    # Showing what was heard beats a bare failure when the time could not be pinned down.
    assert detail["transcript"] == STUB_TRANSCRIPT
    assert "past" in detail["message"]


async def test_failed_parse_persists_nothing(client, fake_parse):
    fake_parse(error=ParseError("nope"))

    await client.post("/voice", files=audio_files(), data={"timezone": TZ})

    assert (await client.get("/reminders")).json() == []


async def test_voice_rejects_an_unknown_timezone(client, fake_parse):
    fake_parse(result=parsed())

    response = await client.post(
        "/voice", files=audio_files(), data={"timezone": "Mars/Olympus"}
    )

    assert response.status_code == 422


async def test_voice_rejects_empty_audio(client, fake_parse):
    fake_parse(result=parsed())

    response = await client.post("/voice", files=audio_files(b""), data={"timezone": TZ})

    assert response.status_code == 422
    assert "empty audio" in response.json()["detail"]


async def test_parse_endpoint_does_not_persist(client, monkeypatch):
    async def _parse(text, tz_name, now_local=None):
        return parsed(task="Call mom")

    monkeypatch.setattr("app.routers.voice.parse_reminder", _parse)

    response = await client.post(
        "/parse", json={"text": "remind me to call mom in an hour", "timezone": TZ}
    )

    assert response.status_code == 200
    assert response.json()["task"] == "Call mom"
    assert (await client.get("/reminders")).json() == []
