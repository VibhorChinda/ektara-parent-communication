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

# A claim older than this belongs to a send that died (e.g. a server restart), so it may be retried.
CLAIM_EXPIRES = timedelta(minutes=10)
# The cron resumes campaigns still 'sending' after RESUME_AFTER, for up to RESUME_MAX_AGE.
RESUME_AFTER = timedelta(minutes=10)
RESUME_MAX_AGE = timedelta(hours=48)


def claim_send(message_id: str) -> bool:
    """Atomically mark a queued message as being sent. False if someone else is sending it.

    This stops a resumed campaign from sending the same message twice.
    """
    expired = (datetime.now(timezone.utc) - CLAIM_EXPIRES).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = (
        supabase.table("messages").update({"send_claimed_at": now_iso()})
        .eq("id", message_id).eq("status", "queued")
        .or_(f"send_claimed_at.is.null,send_claimed_at.lt.{expired}")
        .execute()
    )
    return len(result.data) > 0


def send_one(message: dict, content_sid: str, variables: dict) -> None:
    parent = message["parents"]
    if parent["opted_out"]:
        apply_status(message["id"], "cancelled")
        return
    if not parent["has_whatsapp"]:
        # Stays 'queued'; the cron fallback calls them during the call window.
        return
    if not claim_send(message["id"]):
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


def content_sids(template_ids: set[str]) -> dict[str, str]:
    rows = supabase.table("templates").select("id, twilio_content_sid").in_("id", list(template_ids)).execute().data
    return {t["id"]: t["twilio_content_sid"] for t in rows}


def send_campaign(campaign_id: str) -> None:
    """Send every queued message of a campaign. Runs as a background task, and again from the
    cron if the server died mid-send; claim_send makes a second run harmless."""
    try:
        campaign = supabase.table("campaigns").select("id, status, template_id, variables").eq("id", campaign_id).execute().data[0]
        if campaign["status"] == "cancelled":
            return
        messages = fetch_all(
            lambda: supabase.table("messages")
            .select("id, template_id, parents(phone_e164, has_whatsapp, opted_out)")
            .eq("campaign_id", campaign_id).eq("status", "queued").order("id")
        )
        if messages:
            # Each message uses the template version in its parent's language.
            sids = content_sids({m["template_id"] or campaign["template_id"] for m in messages})
            with ThreadPoolExecutor(max_workers=settings.SEND_CONCURRENCY) as pool:
                for message in messages:
                    sid = sids[message["template_id"] or campaign["template_id"]]
                    pool.submit(send_one_safely, message, sid, campaign["variables"])

        # Never overwrite 'cancelled' (an admin may stop the campaign while it sends).
        supabase.table("campaigns").update({"status": "sent"}).eq("id", campaign_id).in_("status", ["sending", "failed"]).execute()
    except Exception:
        log.exception("Campaign %s failed", campaign_id)
        supabase.table("campaigns").update({"status": "failed"}).eq("id", campaign_id).eq("status", "sending").execute()


def resume_stuck_campaigns() -> dict:
    """Cron job: finish campaigns whose background send died (server restart or sleep)."""
    now = datetime.now(timezone.utc)
    campaigns = (
        supabase.table("campaigns").select("id")
        .in_("status", ["sending", "failed"])
        .lt("created_at", (now - RESUME_AFTER).isoformat())
        .gt("created_at", (now - RESUME_MAX_AGE).isoformat())
        .execute().data
    )
    for campaign in campaigns:
        send_campaign(campaign["id"])
    return {"resumed": len(campaigns)}


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
