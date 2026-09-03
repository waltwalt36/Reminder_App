import httpx

from app.config import Settings
from app.services.transcription.base import VOCABULARY_HINT, Transcriber, TranscriptionError

_URL = "https://api.deepgram.com/v1/listen"


class DeepgramTranscriber(Transcriber):
    """Deepgram Nova-3. Fastest option for the short clips this app produces."""

    name = "deepgram"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        if not settings.deepgram_api_key:
            raise TranscriptionError("DEEPGRAM_API_KEY is not set")

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        self._check_size(audio)

        params = {
            "model": "nova-3",
            "smart_format": "true",
            "punctuate": "true",
            "language": "en-US",
            # Nova-3 keyterm boosting: raises recall on the time words that
            # carry all the meaning in a reminder.
            "keyterm": VOCABULARY_HINT,
        }

        async with self._client() as client:
            try:
                response = await client.post(
                    _URL,
                    params=params,
                    content=audio,
                    headers={
                        "Authorization": f"Token {self.settings.deepgram_api_key}",
                        "Content-Type": content_type,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise TranscriptionError(
                    f"deepgram returned {exc.response.status_code}: {exc.response.text[:200]}"
                ) from exc
            except httpx.HTTPError as exc:
                raise TranscriptionError(f"could not reach deepgram: {exc}") from exc

        try:
            alternatives = response.json()["results"]["channels"][0]["alternatives"]
        except (KeyError, IndexError, ValueError) as exc:
            raise TranscriptionError("unexpected response shape from deepgram") from exc

        if not alternatives:
            raise TranscriptionError("deepgram returned no transcription alternatives")

        transcript = alternatives[0].get("transcript", "").strip()
        if not transcript:
            raise TranscriptionError("no speech detected in the audio")
        return transcript
