from datetime import UTC, datetime, timedelta

import pytest


def future(**kwargs) -> str:
    return (datetime.now(UTC) + timedelta(**kwargs)).isoformat()


async def create(client, **overrides) -> dict:
    payload = {
        "task": "Walk the dog",
        "remind_at": future(hours=2),
        "timezone": "America/New_York",
        "raw_transcript": "Remind me to walk the dog in two hours",
        "parse_confidence": 0.95,
    } | overrides
    response = await client.post("/reminders", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_returns_a_pending_reminder(client):
    body = await create(client)

    assert body["status"] == "pending"
    assert body["snooze_count"] == 0
    assert body["snoozed_until"] is None
    assert body["next_fire_at"] == body["remind_at"]


async def test_create_rejects_an_unknown_timezone(client):
    response = await client.post(
        "/reminders",
        json={"task": "Walk the dog", "remind_at": future(hours=1), "timezone": "Mars/Olympus"},
    )
    assert response.status_code == 422


async def test_get_and_delete_round_trip(client):
    body = await create(client)
    reminder_id = body["id"]

    assert (await client.get(f"/reminders/{reminder_id}")).status_code == 200
    assert (await client.delete(f"/reminders/{reminder_id}")).status_code == 204
    assert (await client.get(f"/reminders/{reminder_id}")).status_code == 404


async def test_snooze_defaults_to_five_minutes(client):
    reminder_id = (await create(client))["id"]

    response = await client.post(f"/reminders/{reminder_id}/snooze", json={})
    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "snoozed"
    assert body["snooze_count"] == 1

    snoozed_until = datetime.fromisoformat(body["snoozed_until"])
    delta = snoozed_until - datetime.now(UTC)
    assert timedelta(minutes=4) < delta <= timedelta(minutes=5)

    # The device schedules against next_fire_at, which a snooze must move.
    assert body["next_fire_at"] == body["snoozed_until"]


async def test_snooze_accepts_an_explicit_interval(client):
    """v2 will expose this in the UI; the API already supports it."""
    reminder_id = (await create(client))["id"]

    body = (await client.post(f"/reminders/{reminder_id}/snooze", json={"minutes": 20})).json()

    delta = datetime.fromisoformat(body["snoozed_until"]) - datetime.now(UTC)
    assert timedelta(minutes=19) < delta <= timedelta(minutes=20)


async def test_repeated_snoozes_accumulate(client):
    reminder_id = (await create(client))["id"]

    await client.post(f"/reminders/{reminder_id}/snooze", json={})
    body = (await client.post(f"/reminders/{reminder_id}/snooze", json={})).json()

    assert body["snooze_count"] == 2


@pytest.mark.parametrize("terminal", ["completed", "dismissed"])
async def test_acknowledged_reminders_never_fire_again(client, terminal):
    reminder_id = (await create(client))["id"]

    body = (await client.patch(f"/reminders/{reminder_id}", json={"status": terminal})).json()

    assert body["status"] == terminal
    # This is the core notification rule: once acknowledged, it is done.
    assert body["next_fire_at"] is None


@pytest.mark.parametrize("terminal", ["completed", "dismissed"])
async def test_a_terminal_reminder_cannot_be_snoozed(client, terminal):
    reminder_id = (await create(client))["id"]
    await client.patch(f"/reminders/{reminder_id}", json={"status": terminal})

    response = await client.post(f"/reminders/{reminder_id}/snooze", json={})
    assert response.status_code == 409


async def test_completing_a_snoozed_reminder_clears_the_snooze(client):
    reminder_id = (await create(client))["id"]
    await client.post(f"/reminders/{reminder_id}/snooze", json={})

    body = (await client.patch(f"/reminders/{reminder_id}", json={"status": "completed"})).json()

    assert body["snoozed_until"] is None
    assert body["next_fire_at"] is None


async def test_upcoming_excludes_terminal_and_past_reminders(client):
    soon = await create(client, task="Soon", remind_at=future(minutes=30))
    later = await create(client, task="Later", remind_at=future(hours=5))
    done = await create(client, task="Done", remind_at=future(hours=1))
    await client.patch(f"/reminders/{done['id']}", json={"status": "completed"})

    body = (await client.get("/reminders", params={"upcoming": True})).json()
    tasks = [r["task"] for r in body]

    assert tasks == ["Soon", "Later"]  # soonest first
    assert soon["id"] == body[0]["id"]
    assert later["id"] == body[1]["id"]


async def test_upcoming_orders_a_snoozed_reminder_by_its_new_time(client):
    """A snooze moves a reminder's place in the queue, not just its status."""
    far = await create(client, task="Far", remind_at=future(hours=3))
    near = await create(client, task="Near", remind_at=future(minutes=10))

    # Snoozing "Near" past "Far" should reorder them.
    await client.post(f"/reminders/{near['id']}/snooze", json={"minutes": 300})

    body = (await client.get("/reminders", params={"upcoming": True})).json()
    assert [r["task"] for r in body] == ["Far", "Near"]


async def test_list_filters_by_status(client):
    await create(client, task="Pending one")
    other = await create(client, task="Other")
    await client.patch(f"/reminders/{other['id']}", json={"status": "dismissed"})

    body = (await client.get("/reminders", params={"status": "dismissed"})).json()

    assert [r["task"] for r in body] == ["Other"]


async def test_patch_can_reschedule_and_edit(client):
    reminder_id = (await create(client))["id"]
    new_time = future(days=1)

    body = (
        await client.patch(
            f"/reminders/{reminder_id}", json={"task": "Walk the cat", "remind_at": new_time}
        )
    ).json()

    assert body["task"] == "Walk the cat"
    assert datetime.fromisoformat(body["remind_at"]) == datetime.fromisoformat(new_time)


async def test_healthz_reports_configuration(client):
    body = (await client.get("/healthz")).json()

    assert body["status"] == "ok"
    assert body["transcription_provider"] == "stub"
