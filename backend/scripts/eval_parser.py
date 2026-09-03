#!/usr/bin/env python
"""Run realistic utterances through the live Claude parser and print the results.

Parsing is the core value prop, so it gets a harness rather than ad-hoc curling.
Requires ANTHROPIC_API_KEY. Costs a fraction of a cent per full run on Haiku.

    .venv/bin/python scripts/eval_parser.py
    .venv/bin/python scripts/eval_parser.py --tz Europe/London
    .venv/bin/python scripts/eval_parser.py "remind me to stretch in 10"

Cases marked `expect_low_confidence` are genuinely ambiguous: the check is not
that the model picks a particular time, but that it admits it guessed.
"""

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.parser import ParseError, parse_reminder  # noqa: E402

# (utterance, expect_low_confidence)
CASES: list[tuple[str, bool]] = [
    # Explicit clock times
    ("Remind me to walk the dog at 6:30 PM", False),
    ("Remind me to take the trash out at 7am tomorrow", False),
    ("Set a reminder for my dentist appointment Friday at 2:15", False),
    # Relative offsets
    ("Remind me to stretch in 20 minutes", False),
    ("Remind me in an hour and a half to check the oven", False),
    ("Wake me up in 45 minutes", False),
    # Parts of day
    ("Remind me to call mom tonight", False),
    ("Remind me to email Sarah tomorrow morning", False),
    ("Remind me to take my meds this evening", False),
    # Day-of-week
    ("Remind me to pay rent on Monday", False),
    ("Remind me about the standup next Tuesday at 9:30", False),
    # No framing verb — just the content
    ("Take the chicken out of the freezer at 5", False),
    ("Laundry in 40 minutes", False),
    # Time embedded in the task itself
    ("Remind me at noon to call Dave about the 3pm meeting", False),
    # Genuinely ambiguous — the model should say so
    ("Remind me to buy milk", True),
    ("Don't let me forget the thing", True),
    ("Remind me about that later", True),
]


async def run_case(text: str, tz: str, now: datetime) -> tuple[str, str]:
    try:
        result = await parse_reminder(text, tz, now)
    except ParseError as exc:
        return "ERROR", str(exc)

    local = result.remind_at_local.strftime("%a %b %d, %I:%M %p").replace(" 0", " ")
    note = f"  ({result.ambiguity_note})" if result.ambiguity_note else ""
    return "OK", f"{result.task!r} @ {local}  conf={result.confidence:.2f}{note}"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("utterance", nargs="*", help="Parse just this instead of the full suite.")
    ap.add_argument("--tz", default="America/New_York", help="IANA timezone to parse against.")
    args = ap.parse_args()

    tz = args.tz
    now = datetime.now(ZoneInfo(tz)).replace(tzinfo=None, microsecond=0)
    print(f"timezone: {tz}   local now: {now:%a %b %d, %I:%M %p}\n")

    if args.utterance:
        cases = [(" ".join(args.utterance), False)]
    else:
        cases = CASES

    results = await asyncio.gather(*(run_case(text, tz, now) for text, _ in cases))

    failures = 0
    for (text, expect_low), (state, detail) in zip(cases, results, strict=True):
        if state == "ERROR":
            failures += 1
            print(f"  FAIL  {text!r}\n        {detail}")
            continue

        # For the ambiguous cases, low confidence is the correct answer.
        conf = float(detail.split("conf=")[1].split()[0])
        flagged = conf < 0.7
        if expect_low and not flagged:
            failures += 1
            marker = "WEAK"  # answered confidently something it could not know
        else:
            marker = "ok  "
        print(f"  {marker}  {text!r}\n        {detail}")

    print(f"\n{len(cases) - failures}/{len(cases)} behaved as expected.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
