"""Pluggable speech-to-text.

v1 transcribes on the backend (see architecture doc §7). Every provider hides
behind `Transcriber`, so switching vendors — or eventually moving transcription
on-device — is a config change plus one new module, not a rewrite.
"""

from app.config import get_settings
from app.services.transcription.base import TranscriptionError, Transcriber
from app.services.transcription.deepgram import DeepgramTranscriber
from app.services.transcription.groq import GroqTranscriber
from app.services.transcription.openai import OpenAITranscriber
from app.services.transcription.stub import StubTranscriber

_PROVIDERS: dict[str, type[Transcriber]] = {
    "deepgram": DeepgramTranscriber,
    "groq": GroqTranscriber,
    "openai": OpenAITranscriber,
    "stub": StubTranscriber,
}

_instance: Transcriber | None = None


def get_transcriber() -> Transcriber:
    global _instance
    if _instance is None:
        settings = get_settings()
        name = settings.transcription_provider.strip().lower()
        try:
            cls = _PROVIDERS[name]
        except KeyError:
            raise TranscriptionError(
                f"unknown TRANSCRIPTION_PROVIDER {name!r}; expected one of {sorted(_PROVIDERS)}"
            ) from None
        _instance = cls(settings)
    return _instance


__all__ = ["Transcriber", "TranscriptionError", "get_transcriber"]
