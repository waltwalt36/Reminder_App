import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status as http_status
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import TERMINAL_STATUSES, Reminder, ReminderStatus
from app.schemas import ReminderCreate, ReminderOut, ReminderUpdate, SnoozeRequest

router = APIRouter(prefix="/reminders", tags=["reminders"])


def as_utc(value: datetime) -> datetime:
    """Naive datetimes from clients are taken as UTC; everything is stored as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def next_fire_at_sql():
    """SQL mirror of `Reminder.next_fire_at` for the non-terminal cases.

    Callers must already have excluded terminal statuses, which fire never.
    """
    return case(
        (Reminder.snoozed_until.isnot(None), Reminder.snoozed_until),
        else_=Reminder.remind_at,
    )


async def _get_or_404(session: AsyncSession, reminder_id: uuid.UUID) -> Reminder:
    reminder = await session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "reminder not found")
    return reminder


@router.post("", response_model=ReminderOut, status_code=http_status.HTTP_201_CREATED)
async def create_reminder(
    payload: ReminderCreate,
    session: AsyncSession = Depends(get_session),
) -> Reminder:
    reminder = Reminder(
        raw_transcript=payload.raw_transcript,
        task=payload.task,
        remind_at=as_utc(payload.remind_at),
        timezone=payload.timezone,
        parse_confidence=payload.parse_confidence,
        ambiguity_note=payload.ambiguity_note,
        status=ReminderStatus.PENDING,
    )
    session.add(reminder)
    await session.commit()
    await session.refresh(reminder)
    return reminder


@router.get("", response_model=list[ReminderOut])
async def list_reminders(
    session: AsyncSession = Depends(get_session),
    status_filter: ReminderStatus | None = Query(default=None, alias="status"),
    upcoming: bool = Query(
        default=False,
        description="Only reminders that will still fire, soonest first. Drives the app's Home screen.",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[Reminder]:
    stmt = select(Reminder)

    if status_filter is not None:
        stmt = stmt.where(Reminder.status == status_filter)

    if upcoming:
        now = datetime.now(UTC)
        stmt = stmt.where(
            Reminder.status.notin_(list(TERMINAL_STATUSES)),
            # A snoozed reminder's real fire time is snoozed_until, not remind_at.
            next_fire_at_sql() >= now,
        ).order_by(next_fire_at_sql().asc())
    else:
        # History reads newest-first.
        stmt = stmt.order_by(Reminder.remind_at.desc())

    result = await session.execute(stmt.limit(limit).offset(offset))
    return list(result.scalars().all())


@router.get("/{reminder_id}", response_model=ReminderOut)
async def get_reminder(
    reminder_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> Reminder:
    return await _get_or_404(session, reminder_id)


@router.patch("/{reminder_id}", response_model=ReminderOut)
async def update_reminder(
    reminder_id: uuid.UUID,
    payload: ReminderUpdate,
    session: AsyncSession = Depends(get_session),
) -> Reminder:
    reminder = await _get_or_404(session, reminder_id)

    if payload.task is not None:
        reminder.task = payload.task
    if payload.remind_at is not None:
        reminder.remind_at = as_utc(payload.remind_at)
    if payload.status is not None:
        reminder.status = payload.status
        # Acknowledging or rescheduling ends any active snooze. Per the v1
        # notification rules, a completed/dismissed reminder never fires again.
        if payload.status is not ReminderStatus.SNOOZED:
            reminder.snoozed_until = None

    await session.commit()
    await session.refresh(reminder)
    return reminder


@router.post("/{reminder_id}/snooze", response_model=ReminderOut)
async def snooze_reminder(
    reminder_id: uuid.UUID,
    payload: SnoozeRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> Reminder:
    reminder = await _get_or_404(session, reminder_id)

    if reminder.status in TERMINAL_STATUSES:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            f"cannot snooze a reminder that is already {reminder.status.value}",
        )

    settings = get_settings()
    minutes = (payload.minutes if payload else None) or settings.default_snooze_minutes

    reminder.status = ReminderStatus.SNOOZED
    reminder.snoozed_until = datetime.now(UTC) + timedelta(minutes=minutes)
    reminder.snooze_count += 1

    await session.commit()
    await session.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_reminder(
    reminder_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    reminder = await _get_or_404(session, reminder_id)
    await session.delete(reminder)
    await session.commit()
    return Response(status_code=http_status.HTTP_204_NO_CONTENT)
