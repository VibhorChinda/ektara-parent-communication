from collections import Counter

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import fetch_all, supabase
from app.routers.templates import PLACEHOLDER
from app.services.sender import send_campaign

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])

STATUSES = ["queued", "sent", "delivered", "read", "confirmed", "declined", "flagged", "failed"]
CHUNK_SIZE = 500
LIST_LIMIT = 100


class CampaignCreate(BaseModel):
    template_id: str
    class_name: str
    variables: dict[str, str]


def count_by_status(rows: list[dict]) -> dict:
    counts = Counter(r["status"] for r in rows)
    return {s: counts.get(s, 0) for s in STATUSES} | {"total": len(rows)}


@router.post("")
def create_campaign(body: CampaignCreate, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    rows = supabase.table("templates").select("*").eq("id", body.template_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    template = rows[0]
    # Re-check at send time: only Meta-approved templates can be sent.
    if template["status"] != "approved":
        raise HTTPException(status_code=400, detail="This template is not approved by WhatsApp yet.")

    numbers = sorted({int(n) for n in PLACEHOLDER.findall(template["body"])})
    variables = {}
    for n in numbers:
        value = (body.variables.get(str(n)) or "").strip()
        if not value:
            raise HTTPException(status_code=400, detail=f"Please fill in a value for {{{{{n}}}}}.")
        if "\n" in value:
            raise HTTPException(status_code=400, detail=f"The value for {{{{{n}}}}} must not contain line breaks.")
        variables[str(n)] = value

    parents = fetch_all(
        lambda: supabase.table("parents").select("id")
        .eq("class_name", body.class_name).eq("opted_out", False).order("id")
    )
    if not parents:
        raise HTTPException(status_code=400, detail=f"No parents found in class {body.class_name}.")

    campaign = supabase.table("campaigns").insert({
        "template_id": template["id"],
        "class_name": body.class_name,
        "variables": variables,
        "created_by": user["id"],
    }).execute().data[0]

    messages = [{"campaign_id": campaign["id"], "parent_id": p["id"]} for p in parents]
    for i in range(0, len(messages), CHUNK_SIZE):
        supabase.table("messages").insert(messages[i : i + CHUNK_SIZE]).execute()

    background_tasks.add_task(send_campaign, campaign["id"])
    return {"id": campaign["id"], "message_count": len(messages)}


@router.get("")
def list_campaigns(user: dict = Depends(get_current_user)):
    campaigns = (
        supabase.table("campaigns").select("*, templates(name)")
        .order("created_at", desc=True).limit(LIST_LIMIT).execute().data
    )
    if not campaigns:
        return []

    ids = [c["id"] for c in campaigns]
    messages = fetch_all(
        lambda: supabase.table("messages").select("campaign_id, status").in_("campaign_id", ids).order("id")
    )
    by_campaign: dict[str, list[dict]] = {}
    for m in messages:
        by_campaign.setdefault(m["campaign_id"], []).append(m)

    return [
        {**c, "template_name": c["templates"]["name"], "counts": count_by_status(by_campaign.get(c["id"], []))}
        for c in campaigns
    ]


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str, status: str | None = None, user: dict = Depends(get_current_user)):
    rows = supabase.table("campaigns").select("*, templates(name, body)").eq("id", campaign_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign = rows[0]

    messages = fetch_all(
        lambda: supabase.table("messages")
        .select("*, parents(parent_name, child_name, phone_e164, has_whatsapp)")
        .eq("campaign_id", campaign_id).order("id")
    )
    counts = count_by_status(messages)
    if status:
        messages = [m for m in messages if m["status"] == status]

    return {
        **campaign,
        "template_name": campaign["templates"]["name"],
        "template_body": campaign["templates"]["body"],
        "counts": counts,
        "messages": messages,
    }
