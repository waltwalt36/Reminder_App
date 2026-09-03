import httpx

from app.config import Settings
from app.services.transcription.base import VOCABULARY_HINT, Transcriber, TranscriptionError

_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


class GroqTranscriber(Transcriber):
    """Whisper Large v3 Turbo on Groq. Cheapest of the hosted options, still fast."""

    name = "groq"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        if not settings.groq_api_key:
            raise TranscriptionError("GROQ_API_KEY is not set")

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        self._check_size(audio)

        async with self._client() as client:
            try:
                response = await client.post(
                    _URL,
                    headers={"Authorization": f"Bearer {self.settings.groq_api_key}"},
                    files={"file": ("audio", audio, content_type)},
                    data={
                        "model": "whisper-large-v3-turbo",
                        "language": "en",
                        "response_format": "json",
                        "prompt": VOCABULARY_HINT,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise TranscriptionError(
                    f"groq returned {exc.response.status_code}: {exc.response.text[:200]}"
                ) from exc
            except httpx.HTTPError as exc:
                raise TranscriptionError(f"could not reach groq: {exc}") from exc

        try:
            transcript = response.json()["text"].strip()
        except (KeyError, ValueError) as exc:
            raise TranscriptionError("unexpected response shape from groq") from exc

        if not transcript:
            raise TranscriptionError("no speech detected in the audio")
        return transcript
