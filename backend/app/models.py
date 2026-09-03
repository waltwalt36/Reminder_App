import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ReminderStatus(str, enum.Enum):
    PENDING = "pending"
    SNOOZED = "snoozed"
    COMPLETED = "completed"
    DISMISSED = "dismissed"


#: Once a reminder reaches one of these it never fires again.
TERMINAL_STATUSES = {ReminderStatus.COMPLETED, ReminderStatus.DISMISSED}


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    raw_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    task: Mapped[str] = mapped_column(Text, nullable=False)

    # Always UTC. The device converts to local time for display and for
    # scheduling the local notification.
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # IANA zone the device was in when the reminder was created. Kept so we can
    # re-render "6:30 PM" correctly and debug parses after the fact.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")

    status: Mapped[ReminderStatus] = mapped_column(
        # native_enum=False keeps this a VARCHAR + CHECK, so adding a status in
        # v2 is an ordinary migration rather than an ALTER TYPE dance (and it
        # works on SQLite in tests).
        Enum(ReminderStatus, native_enum=False, length=16, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ReminderStatus.PENDING,
    )

    # Set when status == snoozed; this is when the device should re-fire.
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    snooze_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Claude's self-reported confidence in the parse (0-1) and a note when the
    # utterance was ambiguous. The app can use these to decide whether the
    # confirmation toast should offer an edit affordance.
    parse_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ambiguity_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_reminders_status_remind_at", "status", "remind_at"),
        CheckConstraint("snooze_count >= 0", name="ck_reminders_snooze_count_non_negative"),
    )

    @property
    def next_fire_at(self) -> datetime | None:
        """When the device should next raise a notification, or None if never again."""
        if self.status in TERMINAL_STATUSES:
            return None
        if self.status is ReminderStatus.SNOOZED and self.snoozed_until is not None:
            return self.snoozed_until
        return self.remind_at
