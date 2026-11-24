"""Session authentication dependency for FastAPI routes."""

from __future__ import annotations

from fastapi import HTTPException, Request

from . import db


def get_session_token(request: Request) -> str:
    """Extract the Bearer session token from the request, or raise 401."""
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid session token")
    token = auth[len("Bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid session token")
    return token


def get_current_uid(request: Request) -> str:
    """Resolve `Authorization: Bearer <session_token>` to the user's uid.

    Raises 401 when the header is missing, malformed, or the session is
    unknown/expired.
    """
    token = get_session_token(request)
    uid = db.get_session_user(token)
    if uid is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return uid
