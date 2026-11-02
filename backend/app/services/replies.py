"""What to do when a parent writes to us on WhatsApp: confirm/decline, opt out, or keep the text."""
import logging
from datetime import datetime, timedelta, timezone

from app.db import log_event, supabase
from app.services import twilio_client
from app.services.status import apply_status, now_iso

log = logging.getLogger(__name__)

CONFIRM_WORDS = {"yes", "confirm", "1"}
DECLINE_WORDS = {"no", "decline", "2", "can't attend", "cant attend"}
STOP_WORDS = {"stop", "stop all", "stopall", "unsubscribe", "opt out", "optout"}
START_WORDS = {"start", "unstop", "subscribe"}
REPLY_WINDOW = timedelta(days=7)
RECOVER_WINDOW = timedelta(hours=3)
MAX_REPLY_LENGTH = 1000


def normalize(text: str) -> str:
    return text.strip().lower().rstrip(".!")


def parse_reply(params: dict) -> str | None:
    """Return 'confirmed', 'declined' or None (any other text)."""
    button = params.get("ButtonPayload", "").strip().lower()
    text = normalize(params.get("Body", ""))
    if button == "confirm" or text in CONFIRM_WORDS:
        return "confirmed"
    if button == "decline" or text in DECLINE_WORDS:
        return "declined"
    return None


def opt_out_choice(params: dict) -> bool | None:
    """True for STOP, False for START, None for anything else."""
    text = normalize(params.get("Body", ""))
    if text in STOP_WORDS:
        return True
    if text in START_WORDS:
        return False
    return None


def phone_of(params: dict) -> str:
    return params.get("From", "").removeprefix("whatsapp:")


def find_replied_message(params: dict) -> str | None:
    # Best match: the message the parent replied to (Twilio sends this for replies within 7 days).
    replied_sid = params.get("OriginalRepliedMessageSid")
    if replied_sid:
        rows = supabase.table("messages").select("id").eq("wa_sid", replied_sid).execute().data
        if rows:
            return rows[0]["id"]

    # Otherwise: the parent's most recent open message from the last 7 days.
    parents = supabase.table("parents").select("id").eq("phone_e164", phone_of(params)).execute().data
    if not parents:
        return None
    since = (datetime.now(timezone.utc) - REPLY_WINDOW).isoformat()
    rows = (
        supabase.table("messages").select("id")
        .eq("parent_id", parents[0]["id"])
        .in_("status", ["sent", "delivered", "read", "flagged"])
        .gte("wa_sent_at", since)
        .order("wa_sent_at", desc=True).limit(1).execute().data
    )
    return rows[0]["id"] if rows else None


def handle_inbound(params: dict, event_id: int) -> None:
    """Apply one inbound WhatsApp message. Safe to run twice for the same message."""
    opt_out = opt_out_choice(params)
    if opt_out is not None:
        # Opted-out parents get no WhatsApp and no calls (sender and fallback check this).
        supabase.table("parents").update({"opted_out": opt_out}).eq("phone_e164", phone_of(params)).execute()
        return

    message_id = find_replied_message(params)
    if not message_id:
        return
    supabase.table("message_events").update({"message_id": message_id}).eq("id", event_id).execute()

    decision = parse_reply(params)
    if decision:
        apply_status(message_id, decision, {"confirmed_via": "whatsapp"})
        return

    # Any other text: keep it so admins can read it on the campaign page.
    text = params.get("Body", "").strip()
    if text:
        supabase.table("messages").update(
            {"reply_text": text[:MAX_REPLY_LENGTH], "replied_at": now_iso(), "updated_at": now_iso()}
        ).eq("id", message_id).execute()


def already_handled(message_sid: str) -> bool:
    rows = (
        supabase.table("message_events").select("id")
        .eq("source", "whatsapp_inbound").eq("payload->>MessageSid", message_sid)
        .limit(1).execute().data
    )
    return len(rows) > 0


def recover_missed_replies() -> dict:
    """Cron job: ask Twilio for recent inbound messages and handle any whose webhook never arrived."""
    since = datetime.now(timezone.utc) - RECOVER_WINDOW
    try:
        inbound = twilio_client.list_inbound_whatsapp(since)
    except twilio_client.TwilioSendError as e:
        log.warning("Could not list inbound WhatsApp messages: %s", e)
        return {"error": str(e)}

    recovered = 0
    for params in inbound:
        if already_handled(params["MessageSid"]):
            continue
        event_id = log_event(None, "whatsapp_inbound", {**params, "recovered": "true"})
        handle_inbound(params, event_id)
        recovered += 1
    return {"checked": len(inbound), "recovered": recovered}
