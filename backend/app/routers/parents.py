import csv
import io
import re

import phonenumbers
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import fetch_all, supabase

router = APIRouter(prefix="/api/parents", tags=["parents"], dependencies=[Depends(get_current_user)])

REQUIRED_COLUMNS = ["parent_name", "phone", "institution", "class_or_year"]
OPTIONAL_COLUMNS = ["child_name", "institution_type", "section", "language", "has_whatsapp"]
TRUE_VALUES = {"true", "yes", "y", "1"}
FALSE_VALUES = {"false", "no", "n", "0"}
COLLEGE_YEARS = {"1", "2", "3", "4"}
CLASS_PREFIX = re.compile(r"^(class|std|grade)\s*", re.IGNORECASE)
CHUNK_SIZE = 200


class Group(BaseModel):
    """One level of the hierarchy. None means 'all' at that level."""
    institution: str
    class_or_year: str | None = None
    section: str | None = None


class ParentEdit(BaseModel):
    parent_name: str
    phone: str
    child_name: str = ""
    institution: str
    institution_type: str = "school"
    class_or_year: str
    section: str = ""
    language: str = "en"
    has_whatsapp: bool = True
    opted_out: bool = False


class MoveGroup(BaseModel):
    source: Group
    class_or_year: str
    section: str | None = None   # only used when the source is a single section


def normalize_phone(raw: str) -> str | None:
    """Return the phone in E.164 (default region India), or None if invalid."""
    try:
        number = phonenumbers.parse(raw, "IN")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(number):
        return None
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def parse_bool(raw: str) -> bool | None:
    value = raw.strip().lower()
    if value == "":
        return True  # column default: assume the parent has WhatsApp
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    return None


def clean_level(institution_type: str, class_or_year: str, section: str) -> tuple[str, str | None, str | None]:
    """Normalize class/year and section. Returns (class_or_year, section, error)."""
    if institution_type == "college":
        digits = "".join(re.findall(r"\d", class_or_year))  # "2nd year" -> "2"
        if digits not in COLLEGE_YEARS:
            return "", None, f"college year must be 1, 2, 3 or 4, got '{class_or_year}'"
        if section:
            return "", None, "colleges have no section; leave section empty"
        return digits, None, None
    value = CLASS_PREFIX.sub("", class_or_year).strip()  # "Class 7" -> "7"
    if not value:
        return "", None, "class_or_year is empty"
    return value, section.upper() or None, None


def clean_parent(
    parent_name: str, phone: str, child_name: str, institution: str, institution_type: str,
    class_or_year: str, section: str, language: str,
) -> tuple[dict | None, str | None]:
    """Validate and normalize one parent. Returns (row, None) or (None, reason)."""
    parent_name = parent_name.strip()
    institution = " ".join(institution.split())  # collapse extra spaces
    institution_type = institution_type.strip().lower() or "school"

    if not parent_name:
        return None, "parent_name is empty"
    if not institution:
        return None, "institution is empty (the school or college name)"
    if institution_type not in ("school", "college"):
        return None, f"institution_type must be school or college, got '{institution_type}'"
    if not class_or_year.strip():
        return None, "class_or_year is empty"

    level, clean_section, error = clean_level(institution_type, class_or_year.strip(), section.strip())
    if error:
        return None, error

    if not phone.strip():
        return None, "phone is empty"
    phone_e164 = normalize_phone(phone.strip())
    if phone_e164 is None:
        return None, f"invalid phone number '{phone.strip()}'"

    return {
        "parent_name": parent_name,
        "phone_e164": phone_e164,
        "child_name": child_name.strip() or None,
        "institution": institution,
        "institution_type": institution_type,
        "class_or_year": level,
        "section": clean_section,
        "language": language.strip().lower() or "en",
    }, None


def parse_row(row: dict) -> tuple[dict | None, str | None]:
    """One CSV row -> (parent_row, None) or (None, reason)."""
    def cell(key: str) -> str:
        return row.get(key) or ""

    parent, reason = clean_parent(
        cell("parent_name"), cell("phone"), cell("child_name"), cell("institution"),
        cell("institution_type"), cell("class_or_year"), cell("section"), cell("language"),
    )
    if parent is None:
        return None, reason

    has_whatsapp = parse_bool(cell("has_whatsapp"))
    if has_whatsapp is None:
        return None, f"has_whatsapp must be yes/no/true/false, got '{cell('has_whatsapp')}'"
    return {**parent, "has_whatsapp": has_whatsapp}, None


def filter_group(query, institution: str | None, class_or_year: str | None, section: str | None):
    """Narrow a parents/campaigns query to one institution, class/year and section."""
    if institution:
        query = query.eq("institution", institution)
    if class_or_year:
        query = query.eq("class_or_year", class_or_year)
    if section:
        query = query.eq("section", section)
    return query


def existing_phones(phones: list[str]) -> set[str]:
    found: set[str] = set()
    for i in range(0, len(phones), CHUNK_SIZE):
        chunk = phones[i : i + CHUNK_SIZE]
        result = supabase.table("parents").select("phone_e164").in_("phone_e164", chunk).execute()
        found.update(r["phone_e164"] for r in result.data)
    return found


@router.post("/upload")
def upload_parents(file: UploadFile = File(...)):
    try:
        text = file.file.read().decode("utf-8-sig")  # utf-8-sig strips Excel's BOM
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be a UTF-8 CSV")

    reader = csv.DictReader(io.StringIO(text))
    header = [h.strip().lower() for h in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
    reader.fieldnames = header

    parents_by_phone: dict[str, dict] = {}
    first_row_for_phone: dict[str, int] = {}
    type_of_institution: dict[str, tuple[str, int]] = {}
    rejected: list[dict] = []

    # Row 1 is the header, so data starts at row 2.
    for row_number, row in enumerate(reader, start=2):
        parent, reason = parse_row(row)
        if parent is None:
            rejected.append({"row": row_number, "phone": row.get("phone"), "reason": reason})
            continue

        known = type_of_institution.get(parent["institution"])
        if known and known[0] != parent["institution_type"]:
            rejected.append({
                "row": row_number,
                "phone": row.get("phone"),
                "reason": f"'{parent['institution']}' is a {known[0]} in row {known[1]}",
            })
            continue

        phone = parent["phone_e164"]
        if phone in parents_by_phone:
            rejected.append({
                "row": row_number,
                "phone": row.get("phone"),
                "reason": f"duplicate phone, already in row {first_row_for_phone[phone]}",
            })
            continue
        parents_by_phone[phone] = parent
        first_row_for_phone[phone] = row_number
        type_of_institution.setdefault(parent["institution"], (parent["institution_type"], row_number))

    phones = list(parents_by_phone)
    already_there = existing_phones(phones)

    # Upsert on phone. opted_out is not in the payload, so an existing
    # parent's opt-out is never reset by a re-upload.
    rows = list(parents_by_phone.values())
    for i in range(0, len(rows), CHUNK_SIZE):
        supabase.table("parents").upsert(rows[i : i + CHUNK_SIZE], on_conflict="phone_e164").execute()

    return {
        "inserted": len(phones) - len(already_there),
        "updated": len(already_there),
        "rejected": len(rejected),
        "errors": rejected,
    }


@router.get("/groups")
def list_groups():
    """Every institution / class-or-year / section with the parents a campaign would reach."""
    rows = fetch_all(
        lambda: supabase.table("parents")
        .select("institution, institution_type, class_or_year, section, language, has_whatsapp")
        .eq("opted_out", False).order("id")
    )
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["institution"], r["class_or_year"], r["section"])
        group = groups.setdefault(key, {
            "institution": r["institution"],
            "institution_type": r["institution_type"],
            "class_or_year": r["class_or_year"],
            "section": r["section"],
            "parent_count": 0,
            "whatsapp_count": 0,
            "languages": {},
        })
        group["parent_count"] += 1
        group["whatsapp_count"] += 1 if r["has_whatsapp"] else 0
        group["languages"][r["language"]] = group["languages"].get(r["language"], 0) + 1
    return sorted(groups.values(), key=lambda g: (g["institution"], g["class_or_year"], g["section"] or ""))


@router.get("")
def list_parents(institution: str | None = None, class_or_year: str | None = None, section: str | None = None):
    parents = fetch_all(
        lambda: filter_group(supabase.table("parents").select("*"), institution, class_or_year, section)
        .order("institution").order("class_or_year").order("parent_name").order("id")
    )
    stats = {
        s["parent_id"]: s
        for s in fetch_all(lambda: supabase.table("parent_response_stats").select("*").order("parent_id"))
    }
    empty = {"total": 0, "responded": 0, "flagged": 0}
    return [{**p, "stats": stats.get(p["id"], empty)} for p in parents]


@router.patch("/{parent_id}")
def update_parent(parent_id: str, body: ParentEdit):
    row, reason = clean_parent(
        body.parent_name, body.phone, body.child_name, body.institution, body.institution_type,
        body.class_or_year, body.section, body.language,
    )
    if row is None:
        raise HTTPException(status_code=400, detail=reason)

    clash = (
        supabase.table("parents").select("id")
        .eq("phone_e164", row["phone_e164"]).neq("id", parent_id).execute().data
    )
    if clash:
        raise HTTPException(status_code=400, detail="Another parent already has this phone number.")

    row |= {"has_whatsapp": body.has_whatsapp, "opted_out": body.opted_out}
    updated = supabase.table("parents").update(row).eq("id", parent_id).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Parent not found")
    return updated[0]


@router.delete("/{parent_id}")
def delete_parent(parent_id: str):
    deleted = supabase.table("parents").delete().eq("id", parent_id).execute().data
    if not deleted:
        raise HTTPException(status_code=404, detail="Parent not found")
    return {"deleted": 1}


@router.post("/move")
def move_group(body: MoveGroup):
    """Year-end promotion: move a class/year (or one section) to a new class/year (and section)."""
    source = body.source
    if not source.institution.strip():
        raise HTTPException(status_code=400, detail="Choose a school or college.")
    if not source.class_or_year:
        raise HTTPException(status_code=400, detail="Choose the class or year to move.")

    sample = (
        filter_group(supabase.table("parents").select("institution_type"), source.institution, source.class_or_year, source.section)
        .limit(1).execute().data
    )
    if not sample:
        raise HTTPException(status_code=404, detail="No parents in this group.")

    level, section, error = clean_level(sample[0]["institution_type"], body.class_or_year.strip(), (body.section or "").strip())
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Moving a whole class keeps each parent's section; moving one section can rename it.
    update = {"class_or_year": level}
    if source.section:
        update["section"] = section
    moved = filter_group(supabase.table("parents").update(update), source.institution, source.class_or_year, source.section).execute().data
    return {"moved": len(moved)}


@router.post("/delete-group")
def delete_group(body: Group):
    """Remove every parent in a group, e.g. a class that has left the school."""
    if not body.institution.strip():
        raise HTTPException(status_code=400, detail="Choose a school or college.")
    deleted = filter_group(supabase.table("parents").delete(), body.institution, body.class_or_year, body.section).execute().data
    return {"deleted": len(deleted)}


@router.get("/{parent_id}/history")
def parent_history(parent_id: str):
    """This parent's latest messages across campaigns."""
    return (
        supabase.table("messages")
        .select("id, status, confirmed_via, reply_text, updated_at, campaigns(id, audience, created_at, templates!campaigns_template_id_fkey(name))")
        .eq("parent_id", parent_id)
        .order("updated_at", desc=True).limit(50).execute().data
    )
