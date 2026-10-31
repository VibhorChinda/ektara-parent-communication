"""Fan out a campaign: one WhatsApp message per parent."""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import fetch_all, log_event, supabase
from app.services import twilio_client
from app.services.status import WHATSAPP_STATUS_MAP, apply_status, now_iso

log = logging.getLogger(__name__)

# Re-check messages that have sat on 'sent' this long, for up to RECHECK_MAX_AGE.
STUCK_AFTER = timedelta(minutes=30)
RECHECK_MAX_AGE = timedelta(hours=24)


def send_one(message: dict, content_sid: str, variables: dict) -> None:
    parent = message["parents"]
    if not parent["has_whatsapp"]:
        # Stays 'queued'; the cron fallback calls them during the call window.
        return
    try:
        sid = twilio_client.send_whatsapp(parent["phone_e164"], content_sid, variables, message["id"])
    except twilio_client.TwilioSendError as e:
        apply_status(message["id"], "failed", {"wa_error": str(e)})
        return

    supabase.table("messages").update(
        {"wa_sid": sid, "wa_sent_at": now_iso(), "updated_at": now_iso()}
    ).eq("id", message["id"]).execute()
    apply_status(message["id"], "sent")


def send_one_safely(message: dict, content_sid: str, variables: dict) -> None:
    # One failure must never stop the campaign.
    try:
        send_one(message, content_sid, variables)
    except Exception:
        log.exception("Sending message %s failed", message["id"])
        try:
            apply_status(message["id"], "failed", {"wa_error": "Unexpected error while sending"})
        except Exception:
            log.exception("Could not mark message %s as failed", message["id"])


def send_campaign(campaign_id: str) -> None:
    """Runs as a FastAPI background task."""
    try:
        campaign = supabase.table("campaigns").select("*, templates(twilio_content_sid)").eq("id", campaign_id).execute().data[0]
        content_sid = campaign["templates"]["twilio_content_sid"]
        messages = fetch_all(
            lambda: supabase.table("messages")
            .select("id, status, parents(phone_e164, has_whatsapp)")
            .eq("campaign_id", campaign_id).eq("status", "queued").order("id")
        )

        with ThreadPoolExecutor(max_workers=settings.SEND_CONCURRENCY) as pool:
            for message in messages:
                pool.submit(send_one_safely, message, content_sid, campaign["variables"])

        supabase.table("campaigns").update({"status": "sent"}).eq("id", campaign_id).execute()
    except Exception:
        log.exception("Campaign %s failed", campaign_id)
        supabase.table("campaigns").update({"status": "failed"}).eq("id", campaign_id).execute()


def recheck_stuck_messages() -> dict:
    """Twilio does not retry lost status callbacks, so ask Twilio directly about
    messages still on 'sent'. Run by the cron tick."""
    now = datetime.now(timezone.utc)
    stuck = fetch_all(
        lambda: supabase.table("messages").select("id, wa_sid")
        .eq("status", "sent")
        .lt("wa_sent_at", (now - STUCK_AFTER).isoformat())
        .gt("wa_sent_at", (now - RECHECK_MAX_AGE).isoformat())
        .order("id")
    )
    updated = 0
    for message in stuck:
        if not message["wa_sid"]:
            continue
        try:
            twilio_status, error = twilio_client.fetch_whatsapp_status(message["wa_sid"])
        except twilio_client.TwilioSendError as e:
            log.warning("Could not fetch status of %s: %s", message["wa_sid"], e)
            continue
        new_status = WHATSAPP_STATUS_MAP.get(twilio_status)
        if new_status is None or new_status == "sent":
            continue
        extra = {"wa_error": error} if new_status == "failed" else {}
        if apply_status(message["id"], new_status, extra):
            log_event(message["id"], "cron", {"recheck_status": twilio_status, "error": error})
            updated += 1
    return {"checked": len(stuck), "updated": updated}
