from supabase import Client, create_client

from app.config import settings

# Service role client: bypasses RLS. Backend only, never sent to the browser.
supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

PAGE_SIZE = 1000


def log_event(message_id: str | None, source: str, payload: dict) -> int:
    """Write a raw webhook/cron payload to message_events. Returns the event id."""
    row = {"message_id": message_id, "source": source, "payload": payload}
    return supabase.table("message_events").insert(row).execute().data[0]["id"]


def fetch_all(build_query) -> list[dict]:
    """Supabase returns at most 1000 rows per request, so page through.

    build_query must return a fresh query each time, e.g.
    lambda: supabase.table("parents").select("*").order("id")
    """
    rows: list[dict] = []
    start = 0
    while True:
        page = build_query().range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE
