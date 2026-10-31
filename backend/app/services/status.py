"""Message status rules. Statuses only move forward; confirmed/declined are final.

Ranking: queued < sent < delivered < read < confirmed/declined.
failed (WhatsApp could not deliver) and flagged (no answer after the call) are
side states: a later confirm/decline still wins over them.
"""
from datetime import datetime, timezone

from app.db import supabase

# For each new status, the statuses it may replace. The check happens inside
# the UPDATE, so out-of-order or repeated callbacks are harmless.
ALLOWED_FROM = {
    "sent": ["queued"],
    "delivered": ["queued", "sent"],
    "read": ["queued", "sent", "delivered"],
    "failed": ["queued", "sent", "delivered"],
    "confirmed": ["queued", "sent", "delivered", "read", "failed", "flagged"],
    "declined": ["queued", "sent", "delivered", "read", "failed", "flagged"],
    "flagged": ["queued", "sent", "delivered", "read", "failed"],
}

# Twilio MessageStatus -> our status. Others (queued, accepted, sending) are ignored.
WHATSAPP_STATUS_MAP = {
    "sent": "sent",
    "delivered": "delivered",
    "read": "read",
    "failed": "failed",
    "undelivered": "failed",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def apply_status(message_id: str, new_status: str, extra: dict | None = None) -> bool:
    """Set the status (plus extra fields) only if allowed. Returns True if the row changed."""
    update = {**(extra or {}), "status": new_status, "updated_at": now_iso()}
    result = (
        supabase.table("messages").update(update)
        .eq("id", message_id)
        .in_("status", ALLOWED_FROM[new_status])
        .execute()
    )
    return len(result.data) > 0
