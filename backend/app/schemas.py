import uuid
from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.models import ReminderStatus


def _ensure_utc(value: datetime) -> datetime:
    """Every instant leaving this API carries an explicit UTC offset.

    Without this a naive timestamp reaches the device as an offsetless string,
    which iOS interprets as *local* time — a reminder set for 22:30 UTC would
    silently schedule for 22:30 Eastern. Postgres returns aware datetimes, but
    the guarantee belongs in the contract rather than in the storage engine.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


#: An instant, always serialized as UTC with an offset.
UtcDateTime = Annotated[datetime, AfterValidator(_ensure_utc)]


def _validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown IANA timezone: {value!r}") from exc
    return value


class ParseRequest(BaseModel):
    """Raw text -> structured reminder, without persisting anything."""

    text: str = Field(min_length=1, max_length=2000)
    timezone: str = Field(default="UTC", description="IANA zone of the device, e.g. America/New_York")
    # The device's current wall-clock time. Lets "in 20 minutes" resolve against
    # the user's clock rather than the server's, and keeps parses reproducible
    # in tests. Falls back to now() in the given zone when omitted.
    now: datetime | None = None

    _check_tz = field_validator("timezone")(_validate_timezone)


class ParseResult(BaseModel):
    """What Claude gives back, normalized into both UTC and local time."""

    task: str
    remind_at: UtcDateTime
    remind_at_local: datetime  # deliberately naive: wall-clock in `timezone`
    timezone: str
    confidence: float = Field(ge=0.0, le=1.0)
    ambiguity_note: str | None = None


class ReminderCreate(BaseModel):
    """Create a reminder from an already-parsed task + time."""

    task: str = Field(min_length=1, max_length=1000)
    remind_at: datetime
    timezone: str = "UTC"
    raw_transcript: str | None = None
    parse_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    ambiguity_note: str | None = None

    _check_tz = field_validator("timezone")(_validate_timezone)


class ReminderUpdate(BaseModel):
    """Partial update. Setting status to completed/dismissed stops all firing."""

    task: str | None = Field(default=None, min_length=1, max_length=1000)
    remind_at: datetime | None = None
    status: ReminderStatus | None = None


class SnoozeRequest(BaseModel):
    # v2: the app will let the user pick this; v1 always sends (or omits) 5.
    minutes: int | None = Field(default=None, ge=1, le=1440)


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    raw_transcript: str | None
    task: str
    remind_at: UtcDateTime
    timezone: str
    status: ReminderStatus
    snoozed_until: UtcDateTime | None
    snooze_count: int
    parse_confidence: float | None
    ambiguity_note: str | None
    #: What the device schedules against. None once acknowledged.
    next_fire_at: UtcDateTime | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class VoiceReminderResponse(BaseModel):
    """One-shot response for the app's main flow: audio in, scheduled reminder out."""

    reminder: ReminderOut
    transcript: str
