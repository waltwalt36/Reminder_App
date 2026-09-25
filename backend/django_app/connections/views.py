import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from anthropic import Anthropic

from .ai import ProviderError, extract_capture, transcribe
from .models import FollowUpReminder, Interaction, Person
from .serializers import (CaptureReviewSerializer, FollowedUpSerializer, InteractionSerializer,
    PersonSerializer, ReminderPatchSerializer, ReminderSerializer, SaveCaptureSerializer, TextCaptureSerializer)

log = logging.getLogger(__name__)


class HealthView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    def get(self, request):
        return Response({"status": "ok", "service": "relationship-memory-api"})


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"
    def post(self, request):
        serializer = TokenObtainPairSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.user
        if not user.is_active:
            return Response({"detail": "Account is disabled."}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(serializer.validated_data)


class CaptureView(APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai"

    def post(self, request):
        tz_name = request.data.get("timezone", "UTC")
        audio_file = request.FILES.get("file")
        if audio_file:
            try:
                transcript = transcribe(audio_file.read(), audio_file.content_type or "audio/m4a")
                source = Interaction.Source.VOICE
            except ProviderError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        else:
            text_data = TextCaptureSerializer(data=request.data)
            text_data.is_valid(raise_exception=True)
            transcript = text_data.validated_data["text"].strip()
            source = Interaction.Source.TEXT
        try:
            fields = extract_capture(transcript, tz_name)
        except ProviderError as exc:
            # Return the transcript so the user can still save the note manually.
            return Response({"detail": str(exc), "transcript": transcript, "source": source,
                             "name": "", "organization": "", "summary": transcript,
                             "occurred_at": None, "suggested_followup_days": 1}, status=status.HTTP_200_OK)
        body = {"transcript": transcript, "source": source, **fields}
        serializer = CaptureReviewSerializer(data=body)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data)


class PeopleView(generics.ListCreateAPIView):
    serializer_class = PersonSerializer
    def get_queryset(self):
        return Person.objects.filter(owner=self.request.user).prefetch_related("interactions", "reminders")
    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class PersonDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PersonSerializer
    lookup_field = "id"
    def get_queryset(self):
        return Person.objects.filter(owner=self.request.user).prefetch_related("interactions", "reminders")


class SaveCaptureView(APIView):
    @transaction.atomic
    def post(self, request):
        data = SaveCaptureSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        if values.get("person_id"):
            person = get_object_or_404(Person, id=values["person_id"], owner=request.user)
            if values["name"]:
                person.name = values["name"]
            if values["organization"]:
                person.organization = values["organization"]
            person.save()
        else:
            if not values["name"].strip():
                return Response({"name": ["Enter a name or choose an existing person."]}, status=400)
            person = Person.objects.create(owner=request.user, name=values["name"].strip(), organization=values["organization"].strip())
        interaction = Interaction.objects.create(person=person, kind=Interaction.Kind.MEETING,
            occurred_at=values.get("occurred_at") or timezone.now(), transcript=values["transcript"],
            summary=values["summary"], source=values["source"])
        due = values.get("follow_up_at")
        if due:
            FollowUpReminder.objects.create(person=person, interaction=interaction,
                title=values["follow_up_title"].strip() or "Follow up", due_at=due,
                created_by=FollowUpReminder.CreatedBy.SUGGESTION)
            person.relationship_state = Person.State.FOLLOW_UP_DUE
            person.save(update_fields=["relationship_state", "updated_at"])
        person.refresh_from_db()
        return Response(PersonSerializer(person).data, status=status.HTTP_201_CREATED)


class PersonInteractionsView(APIView):
    def post(self, request, person_id):
        person = get_object_or_404(Person, id=person_id, owner=request.user)
        data = SaveCaptureSerializer(data={**request.data, "person_id": str(person.id),
            "name": person.name, "organization": person.organization})
        data.is_valid(raise_exception=True)
        values = data.validated_data
        interaction = Interaction.objects.create(person=person, kind=Interaction.Kind.NOTE,
            occurred_at=values.get("occurred_at") or timezone.now(), transcript=values["transcript"],
            summary=values["summary"], source=values["source"])
        due = values.get("follow_up_at")
        if due:
            FollowUpReminder.objects.create(person=person, interaction=interaction,
                title=values["follow_up_title"].strip() or "Follow up", due_at=due,
                created_by=FollowUpReminder.CreatedBy.SUGGESTION)
            person.relationship_state = Person.State.FOLLOW_UP_DUE
            person.save(update_fields=["relationship_state", "updated_at"])
        return Response(InteractionSerializer(interaction).data, status=status.HTTP_201_CREATED)


class InteractionDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = InteractionSerializer
    lookup_field = "id"
    def get_queryset(self):
        return Interaction.objects.filter(person__owner=self.request.user)

    def perform_destroy(self, instance):
        # A removed note should not leave follow-up actions pointing at it.
        instance.reminders.filter(status__in=[FollowUpReminder.Status.SCHEDULED, FollowUpReminder.Status.SNOOZED]).update(status=FollowUpReminder.Status.CANCELLED)
        instance.delete()


class DeleteTranscriptView(APIView):
    def delete(self, request, interaction_id):
        interaction = get_object_or_404(Interaction, id=interaction_id, person__owner=request.user)
        interaction.transcript = ""
        interaction.save(update_fields=["transcript"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class RemindersView(generics.ListCreateAPIView):
    serializer_class = ReminderSerializer
    def get_queryset(self):
        qs = FollowUpReminder.objects.filter(person__owner=self.request.user).select_related("person", "interaction")
        if self.request.query_params.get("active") == "true":
            qs = qs.filter(status__in=[FollowUpReminder.Status.SCHEDULED, FollowUpReminder.Status.SNOOZED])
        return qs
    def create(self, request, *args, **kwargs):
        person = get_object_or_404(Person, id=request.data.get("person_id"), owner=request.user)
        serializer = ReminderPatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reminder = FollowUpReminder.objects.create(person=person, title=serializer.validated_data["title"],
            due_at=serializer.validated_data["due_at"], created_by=FollowUpReminder.CreatedBy.USER)
        return Response(ReminderSerializer(reminder).data, status=status.HTTP_201_CREATED)


class ReminderDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ReminderPatchSerializer
    lookup_field = "id"
    def get_queryset(self):
        return FollowUpReminder.objects.filter(person__owner=self.request.user)
    def retrieve(self, request, *args, **kwargs):
        return Response(ReminderSerializer(self.get_object()).data)
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        for key, value in values.items():
            setattr(instance, key, value)
        if instance.status in [FollowUpReminder.Status.COMPLETED, FollowUpReminder.Status.CANCELLED]:
            instance.completed_at = timezone.now() if instance.status == FollowUpReminder.Status.COMPLETED else None
        instance.save()
        return Response(ReminderSerializer(instance).data)


class FollowedUpView(APIView):
    @transaction.atomic
    def post(self, request, reminder_id):
        reminder = get_object_or_404(FollowUpReminder, id=reminder_id, person__owner=request.user)
        data = FollowedUpSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        reminder.status = FollowUpReminder.Status.COMPLETED
        reminder.completed_at = timezone.now()
        reminder.save(update_fields=["status", "completed_at", "updated_at"])
        note = values.get("note", "").strip()
        interaction = Interaction.objects.create(person=reminder.person, kind=Interaction.Kind.FOLLOW_UP,
            occurred_at=timezone.now(), summary=note or f"Followed up: {reminder.title}", source=Interaction.Source.USER)
        next_at = values.get("next_reminder_at")
        if next_at:
            FollowUpReminder.objects.create(person=reminder.person, interaction=interaction,
                title=values.get("next_reminder_title", "Check in"), due_at=next_at,
                created_by=FollowUpReminder.CreatedBy.SUGGESTION)
            reminder.person.relationship_state = Person.State.WAITING
            reminder.person.save(update_fields=["relationship_state", "updated_at"])
        return Response({"reminder": ReminderSerializer(reminder).data,
            "interaction": InteractionSerializer(interaction).data,
            "person": PersonSerializer(reminder.person).data})


class CoachView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai"
    def post(self, request, person_id):
        person = get_object_or_404(Person.objects.prefetch_related("interactions", "reminders"), id=person_id, owner=request.user)
        if not settings.ANTHROPIC_API_KEY:
            return Response({"detail": "Claude is not configured."}, status=503)
        history = "\n".join(f"{i.occurred_at}: {i.summary or i.transcript}" for i in person.interactions.all())
        prompt = ("Suggest one concise, optional next step for this professional connection. Ground it only in the notes. "
                  "Do not claim to know the other person's intent, do not encourage repeated unwanted contact, and say when there is not enough context.\n"
                  f"Person: {person.name} ({person.organization})\nState: {person.relationship_state}\nNotes:\n{history}")
        try:
            client = Anthropic(api_key=settings.ANTHROPIC_API_KEY,
                default_headers={"anthropic-workspace-id": settings.ANTHROPIC_WORKSPACE_ID} if settings.ANTHROPIC_WORKSPACE_ID else None)
            result = client.messages.create(model=settings.PARSER_MODEL, max_tokens=220, messages=[{"role": "user", "content": prompt}])
            suggestion = " ".join(block.text for block in result.content if getattr(block, "type", None) == "text").strip()
        except Exception as exc:
            log.warning("Claude coaching request failed: %s", type(exc).__name__)
            return Response({"detail": "Couldn't get a suggestion right now."}, status=503)
        return Response({"suggestion": suggestion})
