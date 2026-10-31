import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.db import fetch_all, supabase
from app.models import TemplateCreate, TemplateEdit
from app.services import content_api

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/templates", tags=["templates"])

PLACEHOLDER = re.compile(r"\{\{(\d+)\}\}")
STARTS_WITH_PLACEHOLDER = re.compile(r"^\s*\{\{\d+\}\}")
# Meta also counts a placeholder followed only by punctuation as "ending" the body.
ENDS_WITH_PLACEHOLDER = re.compile(r"\{\{\d+\}\}[\s.,!?:;]*$")
ADJACENT_PLACEHOLDERS = re.compile(r"\}\}\s*\{\{")
PROMO_WORDS = re.compile(r"\b(offer|offers|discount|discounts|sale|sales)\b", re.IGNORECASE)
NAME_PATTERN = re.compile(r"^[a-z0-9_]+$")
LANGUAGE_PATTERN = re.compile(r"^[a-z]{2}(_[A-Z]{2})?$")
VERSION_SUFFIX = re.compile(r"_v\d+$")
MAX_BODY_LENGTH = 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_name(name: str, language: str) -> list[str]:
    errors = []
    if not NAME_PATTERN.match(name):
        errors.append("Name may only contain lowercase letters, digits and underscores.")
    if not LANGUAGE_PATTERN.match(language):
        errors.append("Language must be a code like 'en', 'hi' or 'en_US'.")
    return errors


def validate_content(t: TemplateEdit) -> list[str]:
    errors = []
    body = t.body.strip()

    if not body:
        return ["Body is required."]
    if len(body) > MAX_BODY_LENGTH:
        errors.append(f"Body must be at most {MAX_BODY_LENGTH} characters.")

    numbers = sorted({int(n) for n in PLACEHOLDER.findall(body)})
    if body.count("{{") != len(PLACEHOLDER.findall(body)):
        errors.append("Placeholders must look exactly like {{1}}, {{2}} ...")
    if numbers != list(range(1, len(numbers) + 1)):
        errors.append("Placeholders must be numbered {{1}}, {{2}} ... with no gaps.")
    if STARTS_WITH_PLACEHOLDER.search(body):
        errors.append("Body must not start with a placeholder.")
    if ENDS_WITH_PLACEHOLDER.search(body):
        errors.append("Body must not end with a placeholder.")
    if ADJACENT_PLACEHOLDERS.search(body):
        errors.append("Two placeholders must not be next to each other; put words between them.")

    count = len(numbers)
    if len(t.variable_names) != count or any(not v.strip() for v in t.variable_names):
        errors.append(f"Give a label for each of the {count} placeholders.")
    for i in range(1, count + 1):
        sample = (t.sample_values.get(str(i)) or "").strip()
        if not sample:
            errors.append(f"A sample value is required for {{{{{i}}}}}.")
        elif "\n" in sample:
            errors.append(f"The sample value for {{{{{i}}}}} must not contain line breaks.")

    if t.category == "UTILITY" and PROMO_WORDS.search(body):
        errors.append("UTILITY templates must not contain promotional words like offer, discount or sale.")
    return errors


def get_template(template_id: str) -> dict:
    rows = supabase.table("templates").select("*").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return rows[0]


def name_taken(name: str, language: str) -> bool:
    rows = (
        supabase.table("templates").select("id")
        .eq("name", name).eq("language", language).execute().data
    )
    return len(rows) > 0


def submit_to_meta(template: dict) -> dict:
    """Create the content in Twilio (once) and submit it for WhatsApp approval.

    On failure the template stays 'draft' and can be retried.
    """
    try:
        content_sid = template["twilio_content_sid"]
        if not content_sid:
            content_sid = content_api.create_content(template)
            # Save right away so a retry reuses this content instead of creating another.
            supabase.table("templates").update(
                {"twilio_content_sid": content_sid, "updated_at": now_iso()}
            ).eq("id", template["id"]).execute()
        content_api.submit_whatsapp_approval(content_sid, template["name"], template["category"])
    except content_api.ContentApiError as e:
        log.warning("Submitting template %s failed: %s", template["id"], e)
        raise HTTPException(
            status_code=502,
            detail=f"Saved as draft, but submitting to WhatsApp failed: {e}. Use Retry submit.",
        )

    return (
        supabase.table("templates")
        .update({"status": "pending_meta", "rejection_reason": None, "updated_at": now_iso()})
        .eq("id", template["id"]).execute().data[0]
    )


def insert_and_submit(row: dict) -> dict:
    template = supabase.table("templates").insert(row).execute().data[0]
    return submit_to_meta(template)


@router.get("")
def list_templates(status: str | None = None, user: dict = Depends(get_current_user)):
    def build_query():
        query = supabase.table("templates").select("*")
        if status:
            query = query.eq("status", status)
        return query.order("created_at", desc=True).order("id")

    return fetch_all(build_query)


@router.post("")
def create_template(body: TemplateCreate, user: dict = Depends(get_current_user)):
    errors = validate_name(body.name, body.language) + validate_content(body)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})
    if name_taken(body.name, body.language):
        raise HTTPException(
            status_code=400,
            detail={"errors": [f"A template named '{body.name}' already exists for this language."]},
        )

    return insert_and_submit({
        "name": body.name,
        "language": body.language,
        "category": body.category,
        "body": body.body.strip(),
        "variable_names": body.variable_names,
        "sample_values": body.sample_values,
        "has_confirm_buttons": body.has_confirm_buttons,
        "status": "draft",
        "requested_by": user["id"],
    })


@router.post("/{template_id}/submit")
def retry_submit(template_id: str, user: dict = Depends(get_current_user)):
    template = get_template(template_id)
    if template["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft templates can be submitted.")
    return submit_to_meta(template)


@router.post("/{template_id}/resubmit")
def resubmit(template_id: str, body: TemplateEdit, user: dict = Depends(get_current_user)):
    """Submitted templates can't be edited in WhatsApp, so create a new version (_v2, _v3 ...)."""
    old = get_template(template_id)
    if old["status"] not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Only approved or rejected templates can be resubmitted.")

    errors = validate_content(body)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    base_name = VERSION_SUFFIX.sub("", old["name"])
    version = 2
    while name_taken(f"{base_name}_v{version}", old["language"]):
        version += 1

    return insert_and_submit({
        "name": f"{base_name}_v{version}",
        "language": old["language"],
        "category": body.category,
        "body": body.body.strip(),
        "variable_names": body.variable_names,
        "sample_values": body.sample_values,
        "has_confirm_buttons": body.has_confirm_buttons,
        "status": "draft",
        "requested_by": user["id"],
    })


def sync_pending_templates() -> dict:
    """Called by the cron tick: ask Twilio for Meta's decision on every pending template."""
    pending = fetch_all(
        lambda: supabase.table("templates").select("id, name, twilio_content_sid")
        .eq("status", "pending_meta").order("id")
    )
    approved = rejected = 0

    for template in pending:
        try:
            whatsapp = content_api.fetch_whatsapp_approval(template["twilio_content_sid"])
        except content_api.ContentApiError as e:
            log.warning("Checking template %s failed: %s", template["name"], e)
            continue

        # Twilio docs show both 'Approved' and 'approved', so compare lowercase.
        status = (whatsapp.get("status") or "").lower()
        if status == "approved":
            update = {"status": "approved", "rejection_reason": None}
            approved += 1
        elif status == "rejected":
            update = {"status": "rejected", "rejection_reason": whatsapp.get("rejection_reason") or "Rejected by WhatsApp"}
            rejected += 1
        else:
            # received, pending, paused, disabled, unsubmitted, ...: keep waiting.
            if status not in ("received", "pending"):
                log.info("Template %s has WhatsApp status '%s'", template["name"], status)
            continue

        update["updated_at"] = now_iso()
        supabase.table("templates").update(update).eq("id", template["id"]).eq("status", "pending_meta").execute()

    return {"checked": len(pending), "approved": approved, "rejected": rejected}
