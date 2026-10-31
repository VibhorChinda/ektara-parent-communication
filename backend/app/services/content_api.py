"""Twilio Content API: create templates, submit them to WhatsApp (Meta), read the decision.

Docs: https://www.twilio.com/docs/content/content-api-resources
"""
import httpx

from app.config import settings

BASE_URL = "https://content.twilio.com/v1"
TIMEOUT = 15.0


class ContentApiError(Exception):
    pass


def _request(method: str, path: str, json: dict | None = None) -> dict:
    auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    try:
        response = httpx.request(method, BASE_URL + path, json=json, auth=auth, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        raise ContentApiError(f"Could not reach Twilio: {e}") from e

    if response.status_code >= 400:
        try:
            message = response.json().get("message") or response.text
        except ValueError:
            message = response.text
        raise ContentApiError(f"Twilio error {response.status_code}: {message}")
    return response.json()


def create_content(template: dict) -> str:
    """Create the content template and return its sid (HX...)."""
    if template["has_confirm_buttons"]:
        types = {
            "twilio/quick-reply": {
                "body": template["body"],
                # Button ids come back as ButtonPayload on the inbound webhook.
                "actions": [
                    {"title": "Confirm", "id": "confirm"},
                    {"title": "Can't attend", "id": "decline"},
                ],
            }
        }
    else:
        types = {"twilio/text": {"body": template["body"]}}

    payload = {
        "friendly_name": template["name"],
        "language": template["language"],
        # Default values double as the samples Meta reviews.
        "variables": template["sample_values"],
        "types": types,
    }
    return _request("POST", "/Content", json=payload)["sid"]


def submit_whatsapp_approval(content_sid: str, name: str, category: str) -> None:
    _request(
        "POST",
        f"/Content/{content_sid}/ApprovalRequests/whatsapp",
        json={"name": name, "category": category},
    )


def fetch_whatsapp_approval(content_sid: str) -> dict:
    """Return the 'whatsapp' part of the approval status: status, rejection_reason, ..."""
    data = _request("GET", f"/Content/{content_sid}/ApprovalRequests")
    return data.get("whatsapp") or {}
