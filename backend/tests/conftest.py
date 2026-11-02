"""Fake settings so the app imports without real credentials. Nothing here calls Twilio or Supabase:
tests only cover pure functions, or replace the database helpers with fakes."""
import os

FAKE_ENV = {
    "TWILIO_ACCOUNT_SID": "ACtest",
    "TWILIO_AUTH_TOKEN": "test-token",
    "TWILIO_WHATSAPP_FROM": "whatsapp:+10000000000",
    "TWILIO_VOICE_FROM": "+10000000000",
    "TWILIO_MESSAGING_SERVICE_SID": "",
    "PUBLIC_BASE_URL": "https://api.example.test",
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "header.payload.signature",
    "CRON_SECRET": "test-secret",
    "CALL_FALLBACK_HOURS": "6",
    "CALL_WINDOW_START": "09:00",
    "CALL_WINDOW_END": "19:00",
    "APP_TIMEZONE": "Asia/Kolkata",
}
# Set (not setdefault) so a developer's real environment is never used by tests.
os.environ.update(FAKE_ENV)
