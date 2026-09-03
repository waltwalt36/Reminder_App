import abc

import httpx

from app.config import Settings

# Short utterances only — a reminder is a sentence, not a lecture. Anything
# larger is a client bug or an attempt to run up the transcription bill.
MAX_AUDIO_BYTES = 10 * 1024 * 1024

# Nudges providers that accept a vocabulary hint toward the words this app
# actually hears, which is mostly times and days.
VOCABULARY_HINT = (
    "reminder, remind me, alarm, snooze, today, tomorrow, tonight, morning, "
    "afternoon, evening, AM, PM, o'clock, minutes, hours, Monday, Tuesday, "
    "Wednesday, Thursday, Friday, Saturday, Sunday"
)


class TranscriptionError(RuntimeError):
    """Audio could not be turned into text."""


class Transcriber(abc.ABC):
    #: Human-readable provider name, used in logs and /healthz.
    name: str

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @abc.abstractmethod
    async def transcribe(self, audio: bytes, content_type: str) -> str:
        """Return the transcript for a single short audio clip."""

    @staticmethod
    def _check_size(audio: bytes) -> None:
        if not audio:
            raise TranscriptionError("empty audio payload")
        if len(audio) > MAX_AUDIO_BYTES:
            raise TranscriptionError(
                f"audio is {len(audio)} bytes, over the {MAX_AUDIO_BYTES} byte limit"
            )

    @staticmethod
    def _client() -> httpx.AsyncClient:
        # Short clips: if a provider has not answered in 30s something is wrong
        # and the user is staring at a spinner.
        return httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))
