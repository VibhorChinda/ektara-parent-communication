from fastapi import Header, HTTPException

from app.db import supabase


def get_current_user(authorization: str = Header(default="")) -> dict:
    """Verify the Supabase JWT from the Authorization header. Every logged-in user has full access."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    # Ask Supabase Auth to check the token. This works for both the legacy
    # JWT secret and the newer asymmetric signing keys.
    try:
        response = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {"id": response.user.id, "email": response.user.email}
