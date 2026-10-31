import hmac
import logging

from fastapi import APIRouter, Header, HTTPException

from app.config import settings
from app.routers.templates import sync_pending_templates
from app.services.fallback import run_fallback
from app.services.sender import recheck_stuck_messages

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/cron", tags=["cron"])


@router.post("/tick")
def tick(x_cron_secret: str = Header(default="")):
    if not hmac.compare_digest(x_cron_secret, settings.CRON_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Run every job even if one of them fails. The re-check goes first so
    # newly found failures get their fallback call in the same tick.
    result = {}
    jobs = (
        ("whatsapp_recheck", recheck_stuck_messages),
        ("fallback", run_fallback),
        ("templates", sync_pending_templates),
    )
    for name, job in jobs:
        try:
            result[name] = job()
        except Exception as e:
            log.exception("Cron job %s failed", name)
            result[name] = {"error": str(e)}
    return result
