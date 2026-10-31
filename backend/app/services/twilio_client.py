"""All Twilio Messaging and Voice calls live here, so the provider can be swapped later."""
import json
import logging
import time

from twilio.base.exceptions import TwilioRestException
from twilio.request_validator import RequestValidator
from twilio.rest import Client

from app.config import settings

log = logging.getLogger(__name__)

client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)

MAX_RETRIES = 3


class TwilioSendError(Exception):
    pass


def _with_retry(action):
    """Run a Twilio call, backing off on 429 (rate limited) up to MAX_RETRIES times."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            return action()
        except TwilioRestException as e:
            if e.status == 429 and attempt < MAX_RETRIES:
                time.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            raise TwilioSendError(f"{e.code}: {e.msg}") from e


def send_whatsapp(phone_e164: str, content_sid: str, variables: dict, message_id: str) -> str:
    """Send an approved template. Returns the message sid (SM...)."""
    kwargs = {
        "to": f"whatsapp:{phone_e164}",
        "content_sid": content_sid,
        "content_variables": json.dumps(variables),
        # message_id in the URL lets the callback find the row even if it
        # arrives before we have saved the sid.
        "status_callback": f"{settings.PUBLIC_BASE_URL}/webhooks/whatsapp/status?message_id={message_id}",
    }
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        kwargs["messaging_service_sid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    else:
        kwargs["from_"] = settings.TWILIO_WHATSAPP_FROM

    message = _with_retry(lambda: client.messages.create(**kwargs))
    return message.sid


def fetch_whatsapp_status(message_sid: str) -> tuple[str, str]:
    """Return (status, error) for a sent message, e.g. ("failed", "63015: ...")."""
    message = _with_retry(lambda: client.messages(message_sid).fetch())
    error = ""
    if message.error_code:
        error = f"{message.error_code}: {message.error_message or 'WhatsApp could not deliver the message'}"
    return message.status, error


def place_call(phone_e164: str, message_id: str) -> str:
    """Start the IVR call. Returns the call sid (CA...)."""
    base = settings.PUBLIC_BASE_URL
    call = _with_retry(lambda: client.calls.create(
        to=phone_e164,
        from_=settings.TWILIO_VOICE_FROM,
        url=f"{base}/webhooks/voice/twiml?message_id={message_id}",
        status_callback=f"{base}/webhooks/voice/status?message_id={message_id}",
        status_callback_event=["completed"],
        timeout=25,
    ))
    return call.sid


def is_valid_signature(url: str, params: dict, signature: str) -> bool:
    return validator.validate(url, params, signature)
