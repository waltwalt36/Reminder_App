"""Text -> {task, datetime} via Claude.

This is the core of the product, so it is kept deliberately small and testable:
`build_system_prompt` and `to_parse_result` are pure functions, and only
`parse_reminder` touches the network.
"""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic
from pydantic import BaseModel, Field

from app.config import get_settings
from app.schemas import ParseResult

logger = logging.getLogger(__name__)

# How far in the past a parse may land before we treat it as a failure rather
# than clock skew. Scheduling an iOS notification in the past fires nothing at
# all, so this must never silently pass through.
PAST_TOLERANCE = timedelta(seconds=60)
CLAMP_OFFSET = timedelta(seconds=30)

_LOCAL_FORMAT = "%Y-%m-%dT%H:%M:%S"


class ClaudeParse(BaseModel):
    """The structured output contract with Claude."""

    task: str = Field(description="The thing to be reminded of, as a short imperative phrase.")
    remind_at_local: str = Field(
        description="Local wall-clock time in the user's timezone, formatted YYYY-MM-DDTHH:MM:SS. No offset, no 'Z'."
    )
    confidence: float = Field(ge=0.0, le=1.0, description="0-1 confidence that the time was understood correctly.")
    ambiguity_note: str = Field(
        default="",
        description="Empty string when the request was unambiguous. Otherwise one short sentence naming the assumption made.",
    )


class ParseError(ValueError):
    """The utterance could not be turned into a usable reminder."""


def build_system_prompt(now_local: datetime, tz_name: str) -> str:
    return f"""You convert spoken reminder requests into a task and a time.

The user's timezone is {tz_name}.
Their current local time is {now_local.strftime('%Y-%m-%dT%H:%M:%S')} ({now_local.strftime('%A')}).

Rules:
- `remind_at_local` is local wall-clock time in {tz_name}, formatted YYYY-MM-DDTHH:MM:SS. Never include an offset or 'Z'.
- The time must be in the future relative to the current local time above.
- A bare clock time resolves to the next occurrence: "at 6:30" means today if 6:30 is still ahead, otherwise tomorrow.
- Relative phrases resolve against the current local time: "in 20 minutes", "in an hour", "tonight".
- Vague parts of day: morning = 08:00, noon = 12:00, afternoon = 14:00, evening = 18:00, night = 21:00, midnight = 00:00.
- `task` strips the framing and keeps the substance: "remind me to walk the dog" becomes "Walk the dog". Keep the user's own nouns; do not embellish or add detail they did not say.
- Do not put the time inside `task` unless the time is part of the thing itself (e.g. "Call mom about the 3pm meeting").
- If no time is stated at all, default to one hour from now, set `confidence` below 0.4, and say so in `ambiguity_note`.
- Set `confidence` below 0.7 whenever you had to guess which day or which of two possible times was meant, and name the assumption in `ambiguity_note`.
- Leave `ambiguity_note` as an empty string when the request was unambiguous."""


def to_parse_result(parsed: ClaudeParse, tz_name: str, now_local: datetime) -> ParseResult:
    """Normalize Claude's local wall-clock string into UTC, validating it is usable."""
    tz = ZoneInfo(tz_name)

    try:
        naive_local = datetime.strptime(parsed.remind_at_local, _LOCAL_FORMAT)
    except ValueError as exc:
        raise ParseError(f"model returned an unparseable time: {parsed.remind_at_local!r}") from exc

    task = parsed.task.strip()
    if not task:
        raise ParseError("model returned an empty task")

    aware_local = naive_local.replace(tzinfo=tz)
    now_aware = now_local.replace(tzinfo=tz) if now_local.tzinfo is None else now_local

    delta = aware_local - now_aware
    if delta < -PAST_TOLERANCE:
        raise ParseError(
            f"parsed time {parsed.remind_at_local} is in the past "
            f"(local now is {now_aware.strftime(_LOCAL_FORMAT)})"
        )
    if delta <= timedelta(0):
        # Within tolerance: treat as clock skew or "right now" and nudge forward
        # so the device still has something to schedule.
        aware_local = now_aware + CLAMP_OFFSET
        naive_local = aware_local.replace(tzinfo=None)

    return ParseResult(
        task=task,
        remind_at=aware_local.astimezone(ZoneInfo("UTC")),
        remind_at_local=naive_local,
        timezone=tz_name,
        confidence=parsed.confidence,
        ambiguity_note=parsed.ambiguity_note.strip() or None,
    )


_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.anthropic_api_key:
            raise ParseError("ANTHROPIC_API_KEY is not configured")
        headers = {}
        if settings.anthropic_workspace_id:
            # Required by identity-linked keys; harmless to omit otherwise.
            headers["anthropic-workspace-id"] = settings.anthropic_workspace_id
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            default_headers=headers or None,
        )
    return _client


async def parse_reminder(text: str, tz_name: str, now_local: datetime | None = None) -> ParseResult:
    """Turn a transcript into a structured reminder."""
    settings = get_settings()
    tz = ZoneInfo(tz_name)

    if now_local is None:
        now_local = datetime.now(tz)
    elif now_local.tzinfo is not None:
        now_local = now_local.astimezone(tz)

    naive_now = now_local.replace(tzinfo=None)

    try:
        response = await get_client().messages.parse(
            model=settings.parser_model,
            max_tokens=1024,
            system=build_system_prompt(naive_now, tz_name),
            messages=[{"role": "user", "content": text}],
            output_format=ClaudeParse,
        )
    except anthropic.APIStatusError as exc:
        logger.warning("claude parse failed: status=%s body=%s", exc.status_code, exc.message)
        raise ParseError(f"transcription could not be parsed (upstream {exc.status_code})") from exc
    except anthropic.APIConnectionError as exc:
        raise ParseError("could not reach the parsing service") from exc

    if response.parsed_output is None:
        raise ParseError("model returned no structured output")

    return to_parse_result(response.parsed_output, tz_name, naive_now)
