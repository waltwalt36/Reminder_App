import logging
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Reminder, ReminderStatus
from app.schemas import ParseRequest, ParseResult, ReminderOut, VoiceReminderResponse
from app.services.parser import ParseError, parse_reminder
from app.services.transcription import TranscriptionError, get_transcriber

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])


@router.post("/parse", response_model=ParseResult)
async def parse_text(payload: ParseRequest) -> ParseResult:
    """Text in, structured reminder out. Nothing is persisted.

    Exists so the parsing prompt can be exercised in isolation — it is the
    piece most worth iterating on.
    """
    try:
        return await parse_reminder(payload.text, payload.timezone, payload.now)
    except ParseError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post(
    "/voice",
    response_model=VoiceReminderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reminder_from_voice(
    file: UploadFile = File(..., description="Recorded clip; m4a/aac from iOS."),
    timezone: str = Form(..., description="IANA zone of the device, e.g. America/New_York"),
    now: datetime | None = Form(
        default=None,
        description="Device wall-clock time. Resolves relative phrases against the user's clock, not the server's.",
    ),
    session: AsyncSession = Depends(get_session),
) -> VoiceReminderResponse:
    """The app's main path: audio in, scheduled reminder out, in one round trip."""
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"unknown IANA timezone: {timezone!r}"
        ) from exc

    audio = await file.read()

    try:
        transcript = await get_transcriber().transcribe(
            audio, file.content_type or "audio/m4a"
        )
    except TranscriptionError as exc:
        logger.warning("transcription failed: %s", exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    try:
        parsed = await parse_reminder(transcript, timezone, now)
    except ParseError as exc:
        # Surface the transcript so the app can show what was heard even when
        # the time could not be pinned down.
        logger.info("parse failed for transcript %r: %s", transcript, exc)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": str(exc), "transcript": transcript},
        ) from exc

    reminder = Reminder(
        raw_transcript=transcript,
        task=parsed.task,
        remind_at=parsed.remind_at,
        timezone=parsed.timezone,
        parse_confidence=parsed.confidence,
        ambiguity_note=parsed.ambiguity_note,
        status=ReminderStatus.PENDING,
    )
    session.add(reminder)
    await session.commit()
    await session.refresh(reminder)

    return VoiceReminderResponse(
        reminder=ReminderOut.model_validate(reminder), transcript=transcript
    )
