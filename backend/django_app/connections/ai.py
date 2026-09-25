import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from anthropic import Anthropic
from pydantic import BaseModel, Field
from django.conf import settings

log = logging.getLogger(__name__)
DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
VOCABULARY = ["coffee chat", "career fair", "recruiter", "follow up", "networking"]


class CaptureFields(BaseModel):
    name: str = Field(default="", description="Person's name if stated; otherwise blank.")
    organization: str = Field(default="", description="Company or organization if stated; otherwise blank.")
    summary: str = Field(default="", description="Concise factual notes of what was discussed; do not invent details.")
    occurred_at: str | None = Field(default=None, description="ISO-8601 date/time if stated, otherwise null.")
    suggested_followup_days: int = Field(default=1, ge=1, le=30, description="Suggested interval. Default one day unless context suggests another interval.")


class ProviderError(Exception):
    pass


def transcribe(audio: bytes, content_type: str) -> str:
    if not settings.DEEPGRAM_API_KEY:
        raise ProviderError("Deepgram is not configured on the server.")
    if not audio or len(audio) > 20 * 1024 * 1024:
        raise ProviderError("The recording is empty or too large.")
    params = {"model": "nova-3", "smart_format": "true", "punctuate": "true", "language": "en-US",
              "mip_opt_out": "true", "keyterm": VOCABULARY}
    try:
        response = httpx.post(DEEPGRAM_URL, params=params, content=audio,
            headers={"Authorization": f"Token {settings.DEEPGRAM_API_KEY}", "Content-Type": content_type}, timeout=45)
        response.raise_for_status()
        alternatives = response.json()["results"]["channels"][0]["alternatives"]
        transcript = alternatives[0].get("transcript", "").strip() if alternatives else ""
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        log.warning("Deepgram transcription request failed: %s", type(exc).__name__)
        raise ProviderError("Couldn't transcribe that recording. Please try again or type a note.") from exc
    if not transcript:
        raise ProviderError("I didn't hear speech in that recording. Please try again or type a note.")
    return transcript


def extract_capture(text: str, timezone: str) -> dict:
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ProviderError("The device time zone was not recognized.") from exc
    if not settings.ANTHROPIC_API_KEY:
        raise ProviderError("Claude is not configured on the server.")
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY,
        default_headers={"anthropic-workspace-id": settings.ANTHROPIC_WORKSPACE_ID} if settings.ANTHROPIC_WORKSPACE_ID else None)
    system = (
        "Extract candidate facts from a user's networking conversation note. Never invent a name, organization, date, "
        "or discussion detail. Return a concise summary grounded only in the note. Follow-up timing is a suggestion: "
        "recommend 1 day by default, or another 1-30 day interval only when the user explicitly described timing. "
        "The user will review every field. Current local date/time: " + datetime.now(ZoneInfo(timezone)).isoformat()
    )
    try:
        result = client.messages.parse(model=settings.PARSER_MODEL, max_tokens=700, system=system,
            messages=[{"role": "user", "content": text}], output_format=CaptureFields)
    except Exception as exc:
        log.warning("Claude extraction failed: %s", type(exc).__name__)
        raise ProviderError("Couldn't organize that note right now. The text is still available to save manually.") from exc
    if result.parsed_output is None:
        raise ProviderError("Claude returned no structured details. Please review the transcript and enter details manually.")
    fields = result.parsed_output.model_dump()
    if fields.get("occurred_at"):
        try:
            value = datetime.fromisoformat(fields["occurred_at"])
            fields["occurred_at"] = value.replace(tzinfo=ZoneInfo(timezone)).isoformat() if value.tzinfo is None else value.isoformat()
        except ValueError:
            fields["occurred_at"] = None
    return fields
