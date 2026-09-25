from django.urls import path
from .views import (CaptureView, CoachView, DeleteTranscriptView, FollowedUpView, InteractionDetailView,
    PeopleView, PersonDetailView, PersonInteractionsView, RemindersView, ReminderDetailView, SaveCaptureView)

urlpatterns = [
    path("capture/", CaptureView.as_view(), name="capture"),
    path("capture/save/", SaveCaptureView.as_view(), name="capture-save"),
    path("people/", PeopleView.as_view(), name="people"),
    path("people/<uuid:id>/", PersonDetailView.as_view(), name="person-detail"),
    path("people/<uuid:person_id>/interactions/", PersonInteractionsView.as_view(), name="person-interactions"),
    path("people/<uuid:person_id>/coach/", CoachView.as_view(), name="person-coach"),
    path("interactions/<uuid:id>/", InteractionDetailView.as_view(), name="interaction-detail"),
    path("interactions/<uuid:interaction_id>/transcript/", DeleteTranscriptView.as_view(), name="transcript-delete"),
    path("reminders/", RemindersView.as_view(), name="reminders"),
    path("reminders/<uuid:id>/", ReminderDetailView.as_view(), name="reminder-detail"),
    path("reminders/<uuid:reminder_id>/followed-up/", FollowedUpView.as_view(), name="followed-up"),
]
