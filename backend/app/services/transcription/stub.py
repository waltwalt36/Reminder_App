from app.services.transcription.base import Transcriber

#: Overridable so tests can drive the /voice flow end to end.
STUB_TRANSCRIPT = "Remind me to walk the dog at 6:30 PM"


class StubTranscriber(Transcriber):
    """Returns a canned transcript. For exercising the pipeline without a vendor key."""

    name = "stub"

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        self._check_size(audio)
        return STUB_TRANSCRIPT
