from collections import Counter

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import fetch_all, supabase
from app.routers.parents import filter_group
from app.routers.templates import PLACEHOLDER, VERSION_SUFFIX
from app.services.fallback import next_call_time
from app.services.sender import send_campaign
from app.services.status import now_iso

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])

STATUSES = ["queued", "sent", "delivered", "read", "confirmed", "declined", "flagged", "failed", "cancelled"]
CHUNK_SIZE = 500
PAGE_SIZE = 50
# Explicit foreign keys, so embeds stay unambiguous.
TEMPLATE = "templates!campaigns_template_id_fkey"
SENDER = "profiles!campaigns_created_by_fkey"


class CampaignCreate(BaseModel):
    template_id: str
    institution: str
    class_or_year: str | None = None   # None = every class/year
    section: str | None = None         # None = every section
    variables: dict[str, str]


def count_by_status(rows: list[dict]) -> dict:
    counts = Counter(r["status"] for r in rows)
    return {s: counts.get(s, 0) for s in STATUSES} | {"total": len(rows)}


def placeholder_numbers(body: str) -> list[int]:
    return sorted({int(n) for n in PLACEHOLDER.findall(body)})


def audience_label(institution: str, institution_type: str, class_or_year: str | None, section: str | None) -> str:
    parts = [institution]
    if class_or_year:
        parts.append(("Year " if institution_type == "college" else "Class ") + class_or_year)
    if section:
        parts.append("Section " + section)
    return " · ".join(parts)


def language_versions(template: dict) -> dict[str, dict]:
    """Approved templates with the same name (ignoring _v2...) and placeholders, newest per language.

    Parents get the version in their language; others get the chosen template.
    """
    base = VERSION_SUFFIX.sub("", template["name"])
    numbers = placeholder_numbers(template["body"])
    candidates = (
        supabase.table("templates").select("id, name, language, body")
        .eq("status", "approved").like("name", f"{base}%")
        .order("created_at", desc=True).execute().data
    )
    versions: dict[str, dict] = {}
    for t in candidates:
        if VERSION_SUFFIX.sub("", t["name"]) == base and placeholder_numbers(t["body"]) == numbers:
            versions.setdefault(t["language"], t)
    versions[template["language"]] = template
    return versions


def sender_name(campaign: dict) -> str | None:
    profile = campaign.get("profiles") or {}
    return profile.get("full_name") or profile.get("email")


def get_campaign_row(campaign_id: str) -> dict:
    rows = supabase.table("campaigns").select("id, status").eq("id", campaign_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return rows[0]


@router.post("")
def create_campaign(body: CampaignCreate, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    rows = supabase.table("templates").select("*").eq("id", body.template_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    template = rows[0]
    # Re-check at send time: only Meta-approved templates can be sent.
    if template["status"] != "approved":
        raise HTTPException(status_code=400, detail="This template is not approved by WhatsApp yet.")

    variables = {}
    for n in placeholder_numbers(template["body"]):
        value = (body.variables.get(str(n)) or "").strip()
        if not value:
            raise HTTPException(status_code=400, detail=f"Please fill in a value for {{{{{n}}}}}.")
        if "\n" in value:
            raise HTTPException(status_code=400, detail=f"The value for {{{{{n}}}}} must not contain line breaks.")
        variables[str(n)] = value

    # An empty institution would match every parent, so refuse it.
    if not body.institution.strip():
        raise HTTPException(status_code=400, detail="Choose a school or college.")
    class_or_year = (body.class_or_year or "").strip() or None
    section = None
    if class_or_year:  # a section only makes sense inside a class
        section = (body.section or "").strip() or None
    parents = fetch_all(
        lambda: filter_group(
            supabase.table("parents").select("id, language, institution_type"),
            body.institution, class_or_year, section,
        ).eq("opted_out", False).order("id")
    )
    if not parents:
        raise HTTPException(status_code=400, detail="No parents found in this group.")

    campaign = supabase.table("campaigns").insert({
        "template_id": template["id"],
        "audience": audience_label(body.institution, parents[0]["institution_type"], class_or_year, section),
        "institution": body.institution,
        "class_or_year": class_or_year,
        "section": section,
        "variables": variables,
        "created_by": user["id"],
    }).execute().data[0]

    versions = language_versions(template)
    messages = [
        {
            "campaign_id": campaign["id"],
            "parent_id": p["id"],
            "template_id": versions.get(p["language"], template)["id"],
        }
        for p in parents
    ]
    for i in range(0, len(messages), CHUNK_SIZE):
        supabase.table("messages").insert(messages[i : i + CHUNK_SIZE]).execute()

    background_tasks.add_task(send_campaign, campaign["id"])
    return {"id": campaign["id"], "message_count": len(messages)}


def quoted(value: str) -> str:
    """Quote a value for a PostgREST or= filter (handles commas and brackets)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


@router.get("")
def list_campaigns(
    offset: int = 0,
    institution: str | None = None,
    class_or_year: str | None = None,
    section: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Newest first, PAGE_SIZE at a time. A filter also matches campaigns sent to a wider group
    (e.g. filtering on class 7 shows campaigns sent to the whole school)."""
    query = supabase.table("campaigns").select(f"*, {TEMPLATE}(name), {SENDER}(full_name, email)")
    if institution:
        query = query.eq("institution", institution)
    # One or= filter (repeating or= params is not reliable).
    levels = []
    if class_or_year:
        levels.append(f"or(class_or_year.eq.{quoted(class_or_year)},class_or_year.is.null)")
    if section:
        levels.append(f"or(section.eq.{quoted(section)},section.is.null)")
    if levels:
        query = query.or_(f"and({','.join(levels)})")
    campaigns = query.order("created_at", desc=True).range(offset, offset + PAGE_SIZE - 1).execute().data
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
        {
            **c,
            "template_name": c["templates"]["name"],
            "sender": sender_name(c),
            "counts": count_by_status(by_campaign.get(c["id"], [])),
        }
        for c in campaigns
    ]


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str, status: str | None = None, user: dict = Depends(get_current_user)):
    rows = (
        supabase.table("campaigns")
        .select(f"*, {TEMPLATE}(name, body, has_confirm_buttons), {SENDER}(full_name, email)")
        .eq("id", campaign_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign = rows[0]

    messages = fetch_all(
        lambda: supabase.table("messages")
        .select("*, parents(parent_name, child_name, phone_e164, has_whatsapp, opted_out, language)")
        .eq("campaign_id", campaign_id).order("id")
    )
    counts = count_by_status(messages)
    if status:
        messages = [m for m in messages if m["status"] == status]
    for m in messages:
        m["call_due_at"] = next_call_time(m, campaign["status"])

    return {
        **campaign,
        "template_name": campaign["templates"]["name"],
        "template_body": campaign["templates"]["body"],
        "template_has_buttons": campaign["templates"]["has_confirm_buttons"],
        "sender": sender_name(campaign),
        "counts": counts,
        "messages": messages,
    }


@router.post("/{campaign_id}/cancel")
def cancel_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    """Stop a campaign: unsent messages are cancelled and no more fallback calls are placed.
    Messages already delivered stay as they are, and parents can still reply."""
    get_campaign_row(campaign_id)
    supabase.table("campaigns").update({"status": "cancelled"}).eq("id", campaign_id).execute()
    stopped = (
        supabase.table("messages").update({"status": "cancelled", "updated_at": now_iso()})
        .eq("campaign_id", campaign_id).eq("status", "queued").execute().data
    )
    return {"stopped": len(stopped)}


@router.post("/{campaign_id}/retry-failed")
def retry_failed(campaign_id: str, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Send WhatsApp again to parents whose message failed and who have not been called yet."""
    campaign = get_campaign_row(campaign_id)
    if campaign["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="This campaign was stopped.")

    retried = (
        supabase.table("messages").update({
            "status": "queued",
            "wa_sid": None,
            "wa_sent_at": None,
            "wa_error": None,
            "send_claimed_at": None,
            "updated_at": now_iso(),
        })
        .eq("campaign_id", campaign_id).eq("status", "failed").is_("call_requested_at", "null")
        .execute().data
    )
    if retried:
        supabase.table("campaigns").update({"status": "sending"}).eq("id", campaign_id).execute()
        background_tasks.add_task(send_campaign, campaign_id)
    return {"retried": len(retried)}
