"""The IVR fallback: call parents who have not confirmed. Run by the cron tick."""
import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import settings
from app.db import fetch_all, log_event, supabase
from app.services import twilio_client
from app.services.status import apply_status, now_iso

log = logging.getLogger(__name__)

# Don't call about messages older than this (e.g. if the cron was down for days).
MAX_AGE = timedelta(hours=48)
SELECT = "id, status, parents(phone_e164, has_whatsapp, opted_out)"


def in_call_window() -> bool:
    now = datetime.now(ZoneInfo(settings.APP_TIMEZONE)).time()
    start = time.fromisoformat(settings.CALL_WINDOW_START)
    end = time.fromisoformat(settings.CALL_WINDOW_END)
    return start <= now < end


def find_candidates() -> list[dict]:
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=settings.CALL_FALLBACK_HOURS)).isoformat()
    oldest = (now - MAX_AGE).isoformat()

    # WhatsApp delivered but no answer after CALL_FALLBACK_HOURS.
    waiting = fetch_all(
        lambda: supabase.table("messages").select(SELECT)
        .in_("status", ["sent", "delivered", "read"])
        .lt("wa_sent_at", cutoff).gt("wa_sent_at", oldest)
        .is_("call_requested_at", "null").order("id")
    )
    # Parents without WhatsApp (still queued) and WhatsApp failures: call right away.
    no_whatsapp = fetch_all(
        lambda: supabase.table("messages").select(SELECT)
        .in_("status", ["queued", "failed"])
        .gt("updated_at", oldest)
        .is_("call_requested_at", "null").order("id")
    )
    no_whatsapp = [m for m in no_whatsapp if m["status"] == "failed" or not m["parents"]["has_whatsapp"]]

    return [m for m in waiting + no_whatsapp if not m["parents"]["opted_out"]]


def claim(message_id: str) -> bool:
    """Atomically mark the message as being called. False if another run got it first."""
    result = (
        supabase.table("messages").update({"call_requested_at": now_iso()})
        .eq("id", message_id).is_("call_requested_at", "null").execute()
    )
    return len(result.data) > 0


def run_fallback() -> dict:
    if not in_call_window():
        return {"skipped": "outside call window"}

    called = failed = 0
    for message in find_candidates():
        if not claim(message["id"]):
            continue
        try:
            call_sid = twilio_client.place_call(message["parents"]["phone_e164"], message["id"])
        except Exception as e:  # Twilio or network error: one failure must not stop the rest
            log.warning("Call for message %s failed: %s", message["id"], e)
            log_event(message["id"], "cron", {"action": "place_call", "error": str(e)})
            apply_status(message["id"], "flagged", {"call_status": f"failed: {e}"})
            failed += 1
            continue

        # call_status is left to the status webhook, which may already have run.
        supabase.table("messages").update(
            {"call_sid": call_sid, "updated_at": now_iso()}
        ).eq("id", message["id"]).execute()
        called += 1

    return {"called": called, "call_failed": failed}
