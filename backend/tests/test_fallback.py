from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.fallback import into_call_window, next_call_time

IST = ZoneInfo("Asia/Kolkata")


def message(status="sent", sent_at=None, has_whatsapp=True, opted_out=False, call_requested_at=None):
    return {
        "status": status,
        "wa_sent_at": sent_at.isoformat() if sent_at else None,
        "call_requested_at": call_requested_at,
        "parents": {"has_whatsapp": has_whatsapp, "opted_out": opted_out},
    }


def test_into_call_window():
    assert into_call_window(datetime(2026, 11, 2, 7, 0, tzinfo=IST)) == datetime(2026, 11, 2, 9, 0, tzinfo=IST)
    assert into_call_window(datetime(2026, 11, 2, 12, 30, tzinfo=IST)) == datetime(2026, 11, 2, 12, 30, tzinfo=IST)
    assert into_call_window(datetime(2026, 11, 2, 19, 0, tzinfo=IST)) == datetime(2026, 11, 3, 9, 0, tzinfo=IST)


def test_call_six_hours_after_sending():
    sent = datetime(2026, 11, 2, 10, 0, tzinfo=IST)
    due = next_call_time(message(sent_at=sent), "sent", now=sent + timedelta(hours=1))
    assert datetime.fromisoformat(due) == datetime(2026, 11, 2, 16, 0, tzinfo=IST)


def test_evening_message_is_called_next_morning():
    sent = datetime(2026, 11, 2, 15, 0, tzinfo=IST)
    due = next_call_time(message(sent_at=sent), "sent", now=sent)
    assert datetime.fromisoformat(due) == datetime(2026, 11, 3, 9, 0, tzinfo=IST)


def test_no_call_planned():
    sent = datetime(2026, 11, 2, 10, 0, tzinfo=IST)
    now = sent + timedelta(hours=1)
    assert next_call_time(message(sent_at=sent, opted_out=True), "sent", now) is None
    assert next_call_time(message(sent_at=sent, call_requested_at="x"), "sent", now) is None
    assert next_call_time(message(sent_at=sent), "cancelled", now) is None
    assert next_call_time(message(status="confirmed", sent_at=sent), "sent", now) is None
    assert next_call_time(message(sent_at=sent), "sent", sent + timedelta(days=3)) is None


def test_parent_without_whatsapp_is_called_in_the_next_window():
    now = datetime(2026, 11, 2, 20, 0, tzinfo=IST)
    due = next_call_time(message(status="queued", has_whatsapp=False), "sent", now)
    assert datetime.fromisoformat(due) == datetime(2026, 11, 3, 9, 0, tzinfo=IST)
