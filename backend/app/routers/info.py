from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.config import settings

router = APIRouter(prefix="/api/info", tags=["info"], dependencies=[Depends(get_current_user)])


@router.get("")
def app_info():
    """Settings the admin app shows: fallback timing and rough prices."""
    return {
        "call_fallback_hours": settings.CALL_FALLBACK_HOURS,
        "call_window_start": settings.CALL_WINDOW_START,
        "call_window_end": settings.CALL_WINDOW_END,
        "timezone": settings.APP_TIMEZONE,
        "cost_per_whatsapp": settings.COST_PER_WHATSAPP,
        "cost_per_call": settings.COST_PER_CALL,
        "currency": settings.COST_CURRENCY,
    }
