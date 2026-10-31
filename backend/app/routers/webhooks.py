"""Twilio webhooks. Each one: validate the signature, log the payload, then apply
changes in a way that is safe to repeat (Twilio retries)."""
import logging
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape, quoteattr

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.config import settings
from app.db import log_event, supabase
from app.services import twilio_client
from app.services.status import WHATSAPP_STATUS_MAP, apply_status, now_iso
from app.voice_scripts import get_script

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)

CONFIRM_WORDS = {"yes", "confirm", "1"}
DECLINE_WORDS = {"no", "decline", "2", "can't attend", "cant attend"}
CALL_ENDED = {"completed", "busy", "no-answer", "failed", "canceled"}
REPLY_WINDOW = timedelta(days=7)


async def twilio_params(request: Request) -> dict:
    """Return the form params if the request really comes from Twilio, else 403."""
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}

    # Behind Render's proxy request.url is not the public URL, so rebuild it.
    url = settings.PUBLIC_BASE_URL + request.url.path
    if request.url.query:
        url += "?" + request.url.query

    signature = request.headers.get("X-Twilio-Signature", "")
    if not twilio_client.is_valid_signature(url, params, signature):
        log.warning("Invalid Twilio signature for URL %s (check PUBLIC_BASE_URL and TWILIO_AUTH_TOKEN)", url)
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    return params


def twiml(body: str) -> Response:
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>', media_type="application/xml")


# ---------- WhatsApp ----------

@router.post("/whatsapp/status")
def whatsapp_status(message_id: str | None = None, params: dict = Depends(twilio_params)):
    if not message_id:
        rows = supabase.table("messages").select("id").eq("wa_sid", params.get("MessageSid", "")).execute().data
        message_id = rows[0]["id"] if rows else None
    log_event(message_id, "whatsapp_status", params)
    if not message_id:
        return Response(status_code=204)

    new_status = WHATSAPP_STATUS_MAP.get(params.get("MessageStatus", ""))
    if new_status is None:
        return Response(status_code=204)  # queued, sending, accepted, ...: nothing to do

    extra = {}
    if new_status == "failed":
        reason = params.get("ChannelStatusMessage") or "WhatsApp could not deliver the message"
        extra["wa_error"] = f"{params.get('ErrorCode', '')}: {reason}"
    apply_status(message_id, new_status, extra)
    return Response(status_code=204)


def parse_reply(params: dict) -> str | None:
    """Return 'confirmed', 'declined' or None (any other text)."""
    button = params.get("ButtonPayload", "").strip().lower()
    text = params.get("Body", "").strip().lower().rstrip(".!")
    if button == "confirm" or text in CONFIRM_WORDS:
        return "confirmed"
    if button == "decline" or text in DECLINE_WORDS:
        return "declined"
    return None


def find_replied_message(params: dict) -> str | None:
    # Best match: the message the parent replied to (Twilio sends this for replies within 7 days).
    replied_sid = params.get("OriginalRepliedMessageSid")
    if replied_sid:
        rows = supabase.table("messages").select("id").eq("wa_sid", replied_sid).execute().data
        if rows:
            return rows[0]["id"]

    # Otherwise: the parent's most recent open message from the last 7 days.
    phone = params.get("From", "").removeprefix("whatsapp:")
    parents = supabase.table("parents").select("id").eq("phone_e164", phone).execute().data
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


@router.post("/whatsapp/inbound")
def whatsapp_inbound(params: dict = Depends(twilio_params)):
    event_id = log_event(None, "whatsapp_inbound", params)

    message_id = find_replied_message(params)
    if message_id:
        supabase.table("message_events").update({"message_id": message_id}).eq("id", event_id).execute()
        decision = parse_reply(params)
        if decision:
            apply_status(message_id, decision, {"confirmed_via": "whatsapp"})

    # Empty TwiML: never auto-reply with free text.
    return twiml("")


# ---------- Voice ----------

def load_call_context(message_id: str) -> tuple[dict, str]:
    """Return (script, details) for the message's parent language and campaign values."""
    rows = (
        supabase.table("messages").select("parents(language), campaigns(variables)")
        .eq("id", message_id).execute().data
    )
    if not rows:
        return get_script("en"), ""
    variables = rows[0]["campaigns"]["variables"]
    details = ", ".join(variables[k] for k in sorted(variables, key=int))
    return get_script(rows[0]["parents"]["language"]), details


def say(script: dict, text: str) -> str:
    return f'<Say voice={quoteattr(script["voice"])} language={quoteattr(script["language"])}>{escape(text)}</Say>'


def gather(message_id: str, script: dict, details: str, attempt: int, prefix: str = "") -> Response:
    action = f"{settings.PUBLIC_BASE_URL}/webhooks/voice/gather?message_id={message_id}&attempt={attempt}"
    prompt = (prefix + " " if prefix else "") + script["prompt"].format(details=details)
    return twiml(
        f'<Gather input="dtmf" numDigits="1" timeout="8" action={quoteattr(action)} method="POST">'
        f"{say(script, prompt)}</Gather>"
        f"{say(script, script['goodbye'])}"
    )


@router.post("/voice/twiml")
def voice_twiml(message_id: str, params: dict = Depends(twilio_params)):
    script, details = load_call_context(message_id)
    return gather(message_id, script, details, attempt=1)


@router.post("/voice/gather")
def voice_gather(message_id: str, attempt: int = 1, params: dict = Depends(twilio_params)):
    log_event(message_id, "voice_gather", params)
    digit = params.get("Digits", "")
    script, details = load_call_context(message_id)

    supabase.table("messages").update({"call_digit": digit, "updated_at": now_iso()}).eq("id", message_id).execute()

    if digit == "1":
        apply_status(message_id, "confirmed", {"confirmed_via": "voice"})
        return twiml(say(script, script["confirmed"]))
    if digit == "2":
        apply_status(message_id, "declined", {"confirmed_via": "voice"})
        return twiml(say(script, script["declined"]))

    # Wrong key: replay once, then leave it to the status callback (-> flagged).
    if attempt < 2:
        return gather(message_id, script, details, attempt=2, prefix=script["invalid"])
    return twiml(say(script, script["goodbye"]))


@router.post("/voice/status")
def voice_status(message_id: str, params: dict = Depends(twilio_params)):
    log_event(message_id, "voice_status", params)
    call_status = params.get("CallStatus", "")

    update = {"call_status": call_status, "updated_at": now_iso()}
    if params.get("CallSid"):
        update["call_sid"] = params["CallSid"]
    supabase.table("messages").update(update).eq("id", message_id).execute()

    # Ended without a 1 or 2: flag for personal follow-up. apply_status never
    # overwrites confirmed/declined, so a parent who pressed a key is safe.
    if call_status in CALL_ENDED:
        apply_status(message_id, "flagged")
    return Response(status_code=204)
