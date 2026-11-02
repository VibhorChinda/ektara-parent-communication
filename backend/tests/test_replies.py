from app.services.replies import opt_out_choice, parse_reply


def test_buttons():
    assert parse_reply({"ButtonPayload": "confirm", "Body": "Confirm"}) == "confirmed"
    assert parse_reply({"ButtonPayload": "decline", "Body": "Can't attend"}) == "declined"


def test_text_replies():
    assert parse_reply({"Body": " Yes! "}) == "confirmed"
    assert parse_reply({"Body": "2"}) == "declined"
    # Recovered replies have no ButtonPayload, only the button title as text.
    assert parse_reply({"Body": "Can't attend"}) == "declined"
    assert parse_reply({"Body": "Can I come at 11 instead?"}) is None


def test_opt_out_keywords():
    assert opt_out_choice({"Body": "STOP"}) is True
    assert opt_out_choice({"Body": "unsubscribe."}) is True
    assert opt_out_choice({"Body": "Start"}) is False
    assert opt_out_choice({"Body": "stop the bus at gate 2"}) is None
