#!/usr/bin/env python
"""Run realistic utterances through the live Claude parser and print the results.

Parsing is the core value prop, so it gets a harness rather than ad-hoc curling.
Requires ANTHROPIC_API_KEY. Costs a fraction of a cent per full run on Haiku.

    .venv/bin/python scripts/eval_parser.py
    .venv/bin/python scripts/eval_parser.py --tz Europe/London
    .venv/bin/python scripts/eval_parser.py "remind me to stretch in 10"

Three kinds of case:

* `expect_local` — the case pins its own `now`, so there is exactly one right
  answer and it is the same at any hour you run this. Used for the roll-forward
  rules, which are otherwise only exercised by accident depending on the clock.
* `expect_low_confidence` — genuinely ambiguous. The check is not that Claude
  picks a particular time but that it admits it guessed.
* everything else — must simply parse into a future time without erroring.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.parser import ParseError, parse_reminder  # noqa: E402

FMT = "%Y-%m-%dT%H:%M:%S"

# A Friday afternoon. Chosen so that "Friday", "noon" and "8am" have all
# already passed, which is what makes the roll-forward cases meaningful.
FRIDAY_AFTERNOON = datetime(2026, 9, 4, 14, 20, 0)

# The evening before US DST ends (2026-11-01), so a reminder placed after the
# transition is written in EST while "now" is still EDT.
DST_EVE = datetime(2026, 10, 31, 14, 0, 0)


@dataclass
class Case:
    text: str
    #: Pinned clock. Makes `expect_local` deterministic at any run time.
    now: datetime | None = None
    #: Exact local wall-clock answer required, "YYYY-MM-DDTHH:MM:SS".
    expect_local: str | None = None
    #: Claude should report confidence < 0.7 rather than invent certainty.
    expect_low_confidence: bool = False


CASES: list[Case] = [
    # -- Roll-forward: the stated time has already passed today ----------------
    # These are the cases that silently produce a notification that never fires,
    # so they are pinned rather than left to whatever time the suite runs at.
    Case("Set a reminder for my dentist appointment Friday at 2:15",
         now=FRIDAY_AFTERNOON, expect_local="2026-09-11T14:15:00"),
    Case("Remind me at noon to call Dave about the 3pm meeting",
         now=FRIDAY_AFTERNOON, expect_local="2026-09-05T12:00:00"),
    Case("Remind me to take the trash out at 8am",
         now=FRIDAY_AFTERNOON, expect_local="2026-09-05T08:00:00"),
    # ...but a time still ahead today must NOT roll forward.
    Case("Remind me to walk the dog at 6:30",
         now=FRIDAY_AFTERNOON, expect_local="2026-09-04T18:30:00"),
    # Across the DST boundary: 9am Monday is EST while "now" is still EDT.
    Case("Remind me to call the bank at 9am on Monday",
         now=DST_EVE, expect_local="2026-11-02T09:00:00"),

    # -- Explicit clock times --------------------------------------------------
    Case("Remind me to walk the dog at 6:30 PM"),
    Case("Remind me to take the trash out at 7am tomorrow"),
    # -- Relative offsets ------------------------------------------------------
    Case("Remind me to stretch in 20 minutes"),
    Case("Remind me in an hour and a half to check the oven"),
    Case("Wake me up in 45 minutes"),
    # -- Parts of day ----------------------------------------------------------
    Case("Remind me to call mom tonight"),
    Case("Remind me to email Sarah tomorrow morning"),
    Case("Remind me to take my meds this evening"),
    # -- Day-of-week -----------------------------------------------------------
    Case("Remind me to pay rent on Monday"),
    Case("Remind me about the standup next Tuesday at 9:30"),
    # -- No framing verb, just the content ------------------------------------
    Case("Take the chicken out of the freezer at 5"),
    Case("Laundry in 40 minutes"),
    # -- Genuinely ambiguous: Claude should say so -----------------------------
    Case("Remind me to buy milk", expect_low_confidence=True),
    Case("Don't let me forget the thing", expect_low_confidence=True),
    Case("Remind me about that later", expect_low_confidence=True),
]


async def run_case(case: Case, tz: str, default_now: datetime) -> tuple[bool, str]:
    """Return (passed, one-line detail)."""
    now = case.now or default_now
    try:
        result = await parse_reminder(case.text, tz, now)
    except ParseError as exc:
        return False, f"ERROR: {exc}"

    actual = result.remind_at_local.strftime(FMT)
    pretty = result.remind_at_local.strftime("%a %b %d, %I:%M %p").replace(" 0", " ")
    note = f"  ({result.ambiguity_note})" if result.ambiguity_note else ""
    summary = f"{result.task!r} @ {pretty}  conf={result.confidence:.2f}{note}"

    if case.expect_local is not None and actual != case.expect_local:
        return False, f"{summary}\n        expected {case.expect_local}, got {actual}"

    if case.expect_low_confidence and result.confidence >= 0.7:
        return False, f"{summary}\n        answered confidently something it could not know"

    return True, summary


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("utterance", nargs="*", help="Parse just this instead of the full suite.")
    ap.add_argument("--tz", default="America/New_York", help="IANA timezone to parse against.")
    args = ap.parse_args()

    tz = args.tz
    now = datetime.now(ZoneInfo(tz)).replace(tzinfo=None, microsecond=0)
    print(f"timezone: {tz}   local now: {now:%a %b %d, %I:%M %p}")

    cases = [Case(" ".join(args.utterance))] if args.utterance else CASES
    pinned = sum(1 for c in cases if c.expect_local)
    if pinned:
        print(f"({pinned} cases pin their own clock, so their answers are exact)")
    print()

    results = await asyncio.gather(*(run_case(c, tz, now) for c in cases))

    failures = 0
    for case, (passed, detail) in zip(cases, results, strict=True):
        if not passed:
            failures += 1
        marker = "ok  " if passed else "FAIL"
        clock = f"  [now={case.now:%a %I:%M %p}]" if case.now else ""
        print(f"  {marker}  {case.text!r}{clock}\n        {detail}")

    print(f"\n{len(cases) - failures}/{len(cases)} behaved as expected.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
