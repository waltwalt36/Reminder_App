from rest_framework import serializers
from .models import FollowUpReminder, Interaction, Person


class ReminderSerializer(serializers.ModelSerializer):
    person_name = serializers.CharField(source="person.name", read_only=True)
    class Meta:
        model = FollowUpReminder
        fields = ["id", "person", "person_name", "interaction", "title", "due_at", "status", "created_by", "completed_at", "created_at"]
        read_only_fields = ["id", "person", "interaction", "created_by", "completed_at", "created_at"]


class InteractionSerializer(serializers.ModelSerializer):
    reminders = ReminderSerializer(many=True, read_only=True)

    class Meta:
        model = Interaction
        fields = ["id", "kind", "occurred_at", "transcript", "summary", "source", "created_at", "reminders"]
        read_only_fields = ["id", "created_at", "reminders"]


class PersonSerializer(serializers.ModelSerializer):
    interactions = InteractionSerializer(many=True, read_only=True)
    reminders = ReminderSerializer(many=True, read_only=True)
    active_reminder_count = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = ["id", "name", "organization", "relationship_state", "created_at", "updated_at", "interactions", "reminders", "active_reminder_count"]
        read_only_fields = ["id", "created_at", "updated_at", "interactions", "reminders", "active_reminder_count"]

    def get_active_reminder_count(self, obj):
        return sum(1 for reminder in obj.reminders.all() if reminder.active)


class CaptureReviewSerializer(serializers.Serializer):
    transcript = serializers.CharField(allow_blank=True, max_length=10000)
    source = serializers.ChoiceField(choices=Interaction.Source.choices)
    name = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    organization = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    summary = serializers.CharField(max_length=4000, allow_blank=True, required=False, default="")
    occurred_at = serializers.DateTimeField(required=False, allow_null=True)
    suggested_followup_days = serializers.IntegerField(min_value=1, max_value=30, required=False, default=1)
    follow_up_at = serializers.DateTimeField(required=False, allow_null=True)


class SaveCaptureSerializer(serializers.Serializer):
    person_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=160, allow_blank=True)
    organization = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    transcript = serializers.CharField(allow_blank=True, max_length=10000)
    summary = serializers.CharField(max_length=4000, allow_blank=True, required=False, default="")
    source = serializers.ChoiceField(choices=Interaction.Source.choices)
    occurred_at = serializers.DateTimeField(required=False, allow_null=True)
    follow_up_at = serializers.DateTimeField(required=False, allow_null=True)
    follow_up_title = serializers.CharField(max_length=240, allow_blank=True, required=False, default="Follow up")


class ReminderPatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = FollowUpReminder
        fields = ["title", "due_at", "status"]


class FollowedUpSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")
    next_reminder_at = serializers.DateTimeField(required=False, allow_null=True)
    next_reminder_title = serializers.CharField(max_length=240, required=False, default="Check in")


class TextCaptureSerializer(serializers.Serializer):
    text = serializers.CharField(min_length=1, max_length=10000)
    timezone = serializers.CharField(max_length=64, default="UTC")
