import csv
import io

import phonenumbers
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.auth import get_current_user
from app.db import fetch_all, supabase

router = APIRouter(prefix="/api/parents", tags=["parents"], dependencies=[Depends(get_current_user)])

REQUIRED_COLUMNS = ["parent_name", "phone", "child_name", "class_name", "language", "has_whatsapp"]
TRUE_VALUES = {"true", "yes", "y", "1"}
FALSE_VALUES = {"false", "no", "n", "0"}
CHUNK_SIZE = 200


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


def parse_row(row: dict) -> tuple[dict | None, str | None]:
    """Return (parent_row, None) if valid, or (None, reason) if rejected."""
    parent_name = (row.get("parent_name") or "").strip()
    class_name = (row.get("class_name") or "").strip()
    raw_phone = (row.get("phone") or "").strip()

    if not parent_name:
        return None, "parent_name is empty"
    if not class_name:
        return None, "class_name is empty"
    if not raw_phone:
        return None, "phone is empty"

    phone = normalize_phone(raw_phone)
    if phone is None:
        return None, f"invalid phone number '{raw_phone}'"

    has_whatsapp = parse_bool(row.get("has_whatsapp") or "")
    if has_whatsapp is None:
        return None, f"has_whatsapp must be yes/no/true/false, got '{row.get('has_whatsapp')}'"

    return {
        "parent_name": parent_name,
        "phone_e164": phone,
        "child_name": (row.get("child_name") or "").strip() or None,
        "class_name": class_name,
        "language": (row.get("language") or "").strip().lower() or "en",
        "has_whatsapp": has_whatsapp,
    }, None


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
    header = [h.strip() for h in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
    reader.fieldnames = header

    parents_by_phone: dict[str, dict] = {}
    first_row_for_phone: dict[str, int] = {}
    rejected: list[dict] = []

    # Row 1 is the header, so data starts at row 2.
    for row_number, row in enumerate(reader, start=2):
        parent, reason = parse_row(row)
        if parent is None:
            rejected.append({"row": row_number, "phone": row.get("phone"), "reason": reason})
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


@router.get("/classes")
def list_classes():
    """Class names with the number of parents a campaign would reach."""
    rows = fetch_all(
        lambda: supabase.table("parents").select("class_name").eq("opted_out", False).order("id")
    )
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["class_name"]] = counts.get(r["class_name"], 0) + 1
    return [{"class_name": name, "parent_count": counts[name]} for name in sorted(counts)]


@router.get("")
def list_parents(class_name: str | None = None):
    def build_query():
        query = supabase.table("parents").select("*")
        if class_name:
            query = query.eq("class_name", class_name)
        return query.order("class_name").order("parent_name").order("id")

    return fetch_all(build_query)
