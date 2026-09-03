import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import reminders, voice

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(
    title="Voice Reminder API",
    version="0.1.0",
    description="Speak a reminder; get back a task, a time, and a record to schedule against.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,  # No auth in v1 — nothing to send credentials with.
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reminders.router)
app.include_router(voice.router)


@app.get("/healthz", tags=["meta"])
async def healthz() -> dict[str, object]:
    return {
        "status": "ok",
        "parser_model": settings.parser_model,
        "transcription_provider": settings.transcription_provider,
    }
