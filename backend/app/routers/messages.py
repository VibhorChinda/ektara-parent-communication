from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import log_event, supabase
from app.services.status import set_admin_outcome

router = APIRouter(prefix="/api/messages", tags=["messages"])


class Outcome(BaseModel):
    outcome: Literal["confirmed", "declined"]


@router.post("/{message_id}/resolve")
def resolve(message_id: str, body: Outcome, user: dict = Depends(get_current_user)):
    """An admin spoke to the parent personally and records the answer."""
    if not set_admin_outcome(message_id, body.outcome, user["id"]):
        raise HTTPException(status_code=400, detail="This message can't be changed (it was cancelled or doesn't exist).")
    log_event(message_id, "admin", {"outcome": body.outcome, "by": user["email"]})
    return {"ok": True}


@router.get("/{message_id}/events")
def events(message_id: str, user: dict = Depends(get_current_user)):
    """Raw Twilio callbacks and cron/admin actions for one message, oldest first."""
    return (
        supabase.table("message_events").select("id, source, payload, created_at")
        .eq("message_id", message_id).order("created_at").limit(200).execute().data
    )
