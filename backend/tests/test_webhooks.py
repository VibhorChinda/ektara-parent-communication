"""Signature validation on a webhook, with the database helpers replaced by fakes."""
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from app.main import app
from app.routers import webhooks

client = TestClient(app)
BASE = "https://api.example.test"
PATH = "/webhooks/whatsapp/status?message_id=m1"


def sign(params: dict) -> str:
    return RequestValidator("test-token").compute_signature(BASE + PATH, params)


def test_rejects_a_bad_signature():
    response = client.post(PATH, data={"MessageStatus": "delivered"}, headers={"X-Twilio-Signature": "nope"})
    assert response.status_code == 403


def test_valid_signature_logs_and_applies_status(monkeypatch):
    logged, applied = [], []
    monkeypatch.setattr(webhooks, "log_event", lambda *args: logged.append(args) or 1)
    monkeypatch.setattr(webhooks, "apply_status", lambda *args: applied.append(args) or True)

    params = {"MessageSid": "SM1", "MessageStatus": "delivered"}
    response = client.post(PATH, data=params, headers={"X-Twilio-Signature": sign(params)})

    assert response.status_code == 204
    assert logged[0][1] == "whatsapp_status"
    assert applied == [("m1", "delivered", {})]


def test_unknown_twilio_status_is_ignored(monkeypatch):
    applied = []
    monkeypatch.setattr(webhooks, "log_event", lambda *args: 1)
    monkeypatch.setattr(webhooks, "apply_status", lambda *args: applied.append(args))

    params = {"MessageSid": "SM1", "MessageStatus": "accepted"}
    response = client.post(PATH, data=params, headers={"X-Twilio-Signature": sign(params)})

    assert response.status_code == 204
    assert applied == []
