"""create reminders table

Revision ID: 0001
Revises:
Create Date: 2026-09-02

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ("pending", "snoozed", "completed", "dismissed")


def upgrade() -> None:
    op.create_table(
        "reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("raw_transcript", sa.Text(), nullable=True),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column(
            "status",
            sa.Enum(*STATUSES, native_enum=False, length=16, name="reminderstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("snooze_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parse_confidence", sa.Float(), nullable=True),
        sa.Column("ambiguity_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("snooze_count >= 0", name="ck_reminders_snooze_count_non_negative"),
    )
    op.create_index("ix_reminders_status_remind_at", "reminders", ["status", "remind_at"])


def downgrade() -> None:
    op.drop_index("ix_reminders_status_remind_at", table_name="reminders")
    op.drop_table("reminders")
