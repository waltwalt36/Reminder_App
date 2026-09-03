import httpx

from app.config import Settings
from app.services.transcription.base import VOCABULARY_HINT, Transcriber, TranscriptionError

_URL = "https://api.openai.com/v1/audio/transcriptions"


class OpenAITranscriber(Transcriber):
    """OpenAI gpt-4o-mini-transcribe. The safe, well-documented fallback."""

    name = "openai"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        if not settings.openai_api_key:
            raise TranscriptionError("OPENAI_API_KEY is not set")

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        self._check_size(audio)

        async with self._client() as client:
            try:
                response = await client.post(
                    _URL,
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                    files={"file": ("audio.m4a", audio, content_type)},
                    data={
                        "model": "gpt-4o-mini-transcribe",
                        "language": "en",
                        "response_format": "json",
                        "prompt": VOCABULARY_HINT,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise TranscriptionError(
                    f"openai returned {exc.response.status_code}: {exc.response.text[:200]}"
                ) from exc
            except httpx.HTTPError as exc:
                raise TranscriptionError(f"could not reach openai: {exc}") from exc

        try:
            transcript = response.json()["text"].strip()
        except (KeyError, ValueError) as exc:
            raise TranscriptionError("unexpected response shape from openai") from exc

        if not transcript:
            raise TranscriptionError("no speech detected in the audio")
        return transcript
