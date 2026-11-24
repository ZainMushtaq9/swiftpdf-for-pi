"""Client for the Pi Platform API (https://api.minepi.com/v2).

Auth rules (per Pi docs):
- User verification: GET /v2/me with `Authorization: Bearer <accessToken>`
  (the token Pi.authenticate() gave the frontend). The backend MUST verify
  the token this way and never trust the frontend-supplied user object.
- Payment server calls: `Authorization: Key <Server API Key>` (secret).

Mock mode (PI_MOCK_MODE=true) returns canned data and performs no HTTP.
It is for LOCAL TESTING ONLY and must NEVER be enabled in production:
it would verify any token and mark any payment complete without Pi.
"""

from __future__ import annotations

import logging

import httpx

from .config import settings

logger = logging.getLogger(__name__)

TIMEOUT = 15.0

MOCK_USER = {
    "uid": "mock-user-uid",
    "username": "mockpioneer",
    "wallet_address": "G-MOCK-WALLET",
}


class PiApiError(Exception):
    """Raised when the Pi Platform API call fails (non-200 or network error)."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _request(
    method: str,
    path: str,
    *,
    auth: str,
    json: dict | None = None,
) -> dict:
    url = f"{settings.PI_PLATFORM_API_BASE.rstrip('/')}{path}"
    headers = {"Authorization": auth}
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.request(method, url, headers=headers, json=json)
    except httpx.HTTPError as exc:
        raise PiApiError(f"Pi Platform API unreachable: {exc}") from exc
    if resp.status_code != 200:
        # Never log or return the response body verbatim: it may echo tokens.
        raise PiApiError(
            f"Pi Platform API returned HTTP {resp.status_code} for {method} {path}",
            status_code=resp.status_code,
        )
    try:
        data = resp.json()
    except ValueError as exc:
        raise PiApiError("Pi Platform API returned non-JSON response") from exc
    return data if isinstance(data, dict) else {"value": data}


def verify_token(access_token: str) -> dict:
    """Verify a frontend access token; returns {uid, username, wallet_address?}."""
    if settings.PI_MOCK_MODE:
        logger.warning("PI_MOCK_MODE is ON: verify_token returning canned user")
        return dict(MOCK_USER)
    data = _request("GET", "/me", auth=f"Bearer {access_token}")
    uid = data.get("uid")
    username = data.get("username")
    if not uid or not username:
        raise PiApiError("Pi Platform /me response missing uid/username")
    return {
        "uid": uid,
        "username": username,
        "wallet_address": data.get("wallet_address"),
    }


def approve_payment(payment_id: str) -> dict:
    """Approve a payment created by the frontend (Pi.createPayment)."""
    if settings.PI_MOCK_MODE:
        logger.warning("PI_MOCK_MODE is ON: approve_payment returning canned ok")
        return {"ok": True}
    return _request(
        "POST",
        f"/payments/{payment_id}/approve",
        auth=f"Key {settings.PI_API_KEY}",
    )


def complete_payment(payment_id: str, txid: str) -> dict:
    """Complete a payment after the user signed it in the Pi Wallet."""
    if settings.PI_MOCK_MODE:
        logger.warning("PI_MOCK_MODE is ON: complete_payment returning canned ok")
        return {"ok": True}
    return _request(
        "POST",
        f"/payments/{payment_id}/complete",
        auth=f"Key {settings.PI_API_KEY}",
        json={"txid": txid},
    )


def cancel_payment(payment_id: str) -> dict:
    if settings.PI_MOCK_MODE:
        logger.warning("PI_MOCK_MODE is ON: cancel_payment returning canned ok")
        return {"ok": True}
    return _request(
        "POST",
        f"/payments/{payment_id}/cancel",
        auth=f"Key {settings.PI_API_KEY}",
    )


def get_payment_status(payment_id: str) -> dict:
    """Look up a payment on the Platform (used by reverify)."""
    if settings.PI_MOCK_MODE:
        logger.warning("PI_MOCK_MODE is ON: get_payment_status returning canned completed")
        return {"identifier": payment_id, "status": {"developer_completed": True}}
    return _request("GET", f"/payments/{payment_id}", auth=f"Key {settings.PI_API_KEY}")
