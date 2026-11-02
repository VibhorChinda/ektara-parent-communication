from app.services.status import ADMIN_OUTCOME_FROM, ALLOWED_FROM, WHATSAPP_STATUS_MAP

RANK = {"queued": 0, "sent": 1, "delivered": 2, "read": 3, "confirmed": 4, "declined": 4}


def test_progress_statuses_only_move_forward():
    for new in ("sent", "delivered", "read"):
        for old in ALLOWED_FROM[new]:
            assert RANK[old] < RANK[new], f"{old} -> {new} moves backwards"


def test_confirmed_and_declined_are_never_overwritten_by_callbacks():
    for new, allowed in ALLOWED_FROM.items():
        assert "confirmed" not in allowed, new
        assert "declined" not in allowed, new


def test_cancelled_is_final_and_only_reached_from_queued():
    assert ALLOWED_FROM["cancelled"] == ["queued"]
    for allowed in ALLOWED_FROM.values():
        assert "cancelled" not in allowed
    assert "cancelled" not in ADMIN_OUTCOME_FROM


def test_read_is_not_a_confirmation():
    assert WHATSAPP_STATUS_MAP["read"] == "read"


def test_a_reply_beats_failed_and_flagged():
    for outcome in ("confirmed", "declined"):
        assert "failed" in ALLOWED_FROM[outcome]
        assert "flagged" in ALLOWED_FROM[outcome]
