"""Unit tests for the pure half of the parsing service.

The network call is not exercised here; `to_parse_result` is where the
timezone and past-time correctness lives, and that is what can silently
produce a notification that never fires.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.parser import ClaudeParse, ParseError, build_system_prompt, to_parse_result

TZ = "America/New_York"
NOW = datetime(2026, 9, 2, 14, 0, 0)  # Wednesday 2pm local


def make(remind_at_local: str, task: str = "Walk the dog", confidence: float = 0.95, note: str = ""):
    return ClaudeParse(
        task=task, remind_at_local=remind_at_local, confidence=confidence, ambiguity_note=note
    )


def test_converts_local_wall_clock_to_utc():
    result = to_parse_result(make("2026-09-02T18:30:00"), TZ, NOW)

    # New York is UTC-4 in September (EDT), so 18:30 local is 22:30 UTC.
    assert result.remind_at == datetime(2026, 9, 2, 22, 30, tzinfo=ZoneInfo("UTC"))
    assert result.remind_at_local == datetime(2026, 9, 2, 18, 30)
    assert result.timezone == TZ
    assert result.task == "Walk the dog"


def test_handles_a_zone_on_the_other_side_of_the_date_line():
    result = to_parse_result(make("2026-09-03T09:00:00"), "Asia/Tokyo", NOW)

    # Tokyo is UTC+9, so 09:00 on the 3rd is 00:00 UTC on the 3rd.
    assert result.remind_at == datetime(2026, 9, 3, 0, 0, tzinfo=ZoneInfo("UTC"))


def test_rejects_a_time_meaningfully_in_the_past():
    # An iOS notification scheduled in the past never fires, so this must be
    # an error rather than a silently accepted reminder.
    with pytest.raises(ParseError, match="in the past"):
        to_parse_result(make("2026-09-02T09:00:00"), TZ, NOW)


def test_clamps_a_time_that_is_barely_in_the_past():
    # Within tolerance: clock skew between device and server, not a bad parse.
    result = to_parse_result(make("2026-09-02T13:59:30"), TZ, NOW)

    assert result.remind_at_local > NOW
    assert result.remind_at_local - NOW <= timedelta(seconds=30)


def test_rejects_an_unparseable_time_string():
    with pytest.raises(ParseError, match="unparseable time"):
        to_parse_result(make("tomorrow at six"), TZ, NOW)


def test_rejects_an_empty_task():
    with pytest.raises(ParseError, match="empty task"):
        to_parse_result(make("2026-09-02T18:30:00", task="   "), TZ, NOW)


def test_blank_ambiguity_note_becomes_none():
    result = to_parse_result(make("2026-09-02T18:30:00", note="  "), TZ, NOW)
    assert result.ambiguity_note is None


def test_ambiguity_note_is_preserved():
    result = to_parse_result(
        make("2026-09-03T08:00:00", confidence=0.5, note="Assumed tomorrow morning."), TZ, NOW
    )
    assert result.ambiguity_note == "Assumed tomorrow morning."
    assert result.confidence == 0.5


def test_system_prompt_carries_the_users_clock_and_zone():
    prompt = build_system_prompt(NOW, TZ)

    # Relative phrases ("in 20 minutes") are unresolvable without these.
    assert "2026-09-02T14:00:00" in prompt
    assert "Wednesday" in prompt
    assert TZ in prompt
