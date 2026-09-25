#!/usr/bin/env bash
# Create a reminder N minutes out, for testing that notifications actually fire.
#
#   ./scripts/test_reminder.sh            # 2 minutes out
#   ./scripts/test_reminder.sh 5          # 5 minutes out
#   ./scripts/test_reminder.sh 3 "Take the pizza out"
#
# NOTE: creating it here only stores it. The device schedules the actual
# notification on its next foreground resync — so open the app afterwards.
set -euo pipefail

MINUTES="${1:-2}"
TASK="${2:-Test notification}"
IP=$(ipconfig getifaddr en0 2>/dev/null || echo localhost)
WHEN=$(date -u -v+"${MINUTES}"M +%Y-%m-%dT%H:%M:%SZ)

curl -s -X POST "http://${IP}:8000/reminders" \
  -H 'Content-Type: application/json' \
  -d "{\"task\":\"${TASK}\",\"remind_at\":\"${WHEN}\",\"timezone\":\"$(readlink /etc/localtime | sed 's|.*zoneinfo/||')\"}" \
  | python3 -c "
import sys, json, datetime
r = json.load(sys.stdin)
fire = datetime.datetime.fromisoformat(r['next_fire_at'].replace('Z','+00:00')).astimezone()
print(f\"✅ '{r['task']}' → fires at {fire:%-I:%M:%S %p} local\")
print('   Now open the app so the device schedules it, then lock your phone.')
"
