from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_WHATSAPP_FROM: str
    TWILIO_VOICE_FROM: str
    TWILIO_MESSAGING_SERVICE_SID: str = ""

    PUBLIC_BASE_URL: str

    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str = ""

    CRON_SECRET: str
    WEB_ORIGIN: str = "http://localhost:3000"

    CALL_FALLBACK_HOURS: int = 6
    CALL_WINDOW_START: str = "09:00"
    CALL_WINDOW_END: str = "19:00"
    APP_TIMEZONE: str = "Asia/Kolkata"
    SEND_CONCURRENCY: int = 10

    # A trailing slash would break Twilio signature validation.
    @field_validator("PUBLIC_BASE_URL", "WEB_ORIGIN")
    @classmethod
    def strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")


settings = Settings()
