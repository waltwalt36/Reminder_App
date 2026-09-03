from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/reminders"

    anthropic_api_key: str = ""
    # Identity-linked API keys must name the workspace they act in. Org-scoped
    # keys do not; leave this blank for those.
    anthropic_workspace_id: str = ""
    parser_model: str = "claude-haiku-4-5"

    transcription_provider: str = "deepgram"
    deepgram_api_key: str = ""
    groq_api_key: str = ""
    openai_api_key: str = ""

    cors_origins: str = "*"
    default_snooze_minutes: int = 5
    log_level: str = "INFO"

    @property
    def async_database_url(self) -> str:
        """Railway hands out postgresql:// URLs; asyncpg needs its own scheme."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
