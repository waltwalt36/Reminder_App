import uuid
from django.conf import settings
from django.db import models


class Person(models.Model):
    class State(models.TextChoices):
        NEW = "new", "New"
        FOLLOW_UP_DUE = "follow_up_due", "Follow-up due"
        WAITING = "waiting_for_reply", "Waiting for reply"
        MEETING = "meeting_scheduled", "Meeting scheduled"
        NO_ACTION = "no_action", "No action"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="people")
    name = models.CharField(max_length=160, blank=True)
    organization = models.CharField(max_length=160, blank=True)
    relationship_state = models.CharField(max_length=24, choices=State.choices, default=State.NEW)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "created_at"]

    def __str__(self):
        return self.name or "Unnamed connection"


class Interaction(models.Model):
    class Kind(models.TextChoices):
        MEETING = "meeting_note", "Meeting note"
        FOLLOW_UP = "follow_up_sent", "Follow-up sent"
        REPLY = "reply_received", "Reply received"
        CHAT = "meeting_scheduled", "Meeting scheduled"
        NOTE = "note", "Note"

    class Source(models.TextChoices):
        VOICE = "voice", "Voice"
        TEXT = "text", "Text"
        USER = "user", "User update"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="interactions")
    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.MEETING)
    occurred_at = models.DateTimeField(null=True, blank=True)
    transcript = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.TEXT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at", "-created_at"]


class FollowUpReminder(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        SNOOZED = "snoozed", "Snoozed"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class CreatedBy(models.TextChoices):
        USER = "user", "User"
        SUGGESTION = "user_confirmed_ai_suggestion", "User-confirmed suggestion"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="reminders")
    interaction = models.ForeignKey(Interaction, on_delete=models.SET_NULL, null=True, blank=True, related_name="reminders")
    title = models.CharField(max_length=240)
    due_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED, db_index=True)
    created_by = models.CharField(max_length=40, choices=CreatedBy.choices, default=CreatedBy.USER)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_at", "created_at"]

    @property
    def active(self):
        return self.status in {self.Status.SCHEDULED, self.Status.SNOOZED}
