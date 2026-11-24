"""FastAPI app for the SwiftPDF for Pi backend (Pi Next 2026).

Endpoints (all JSON):
- GET  /api/health                  public
- GET  /api/config                  public, no secrets
- POST /api/auth/verify             exchange a Pi access token for a session
- POST /api/auth/logout             auth required
- GET  /api/entitlements            auth required
- POST /api/entitlements/reverify   auth required (rebuilds Pro from Platform records)
- POST /api/payments/approve        auth required
- POST /api/payments/complete       auth required
- POST /api/payments/cancel         auth required
- GET  /api/payments/{payment_id}   auth required

Error contract: bad/missing session -> 401; unknown payment -> 404;
Pi Platform API failure -> 502. The Pi Server API Key never appears in any
response or log line.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db, pi_api
from .auth import get_current_uid, get_session_token
from .config import settings
from .pi_api import PiApiError


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="SwiftPDF for Pi — Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- request models -------------------------------------------------------

class VerifyRequest(BaseModel):
    access_token: str


class ApproveRequest(BaseModel):
    payment_id: str


class CompleteRequest(BaseModel):
    payment_id: str
    txid: str


class CancelRequest(BaseModel):
    payment_id: str


# ---- helpers --------------------------------------------------------------

def _tier_for(uid: str) -> tuple[bool, str, dict | None]:
    ent = db.get_entitlement(uid)
    if ent and ent["tier"] == "pro":
        return True, "pro", ent
    return False, "free", ent


# ---- public endpoints -----------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "network": settings.PI_NETWORK,
        "mock_mode": settings.PI_MOCK_MODE,
    }


@app.get("/api/config")
def config():
    return {
        "pro_price_pi": settings.PRO_PRICE_PI,
        "pro_memo": settings.PRO_MEMO,
        "network": settings.PI_NETWORK,
        "app_name": "SwiftPDF for Pi",
    }


# ---- auth -----------------------------------------------------------------

@app.post("/api/auth/verify")
def auth_verify(body: VerifyRequest):
    try:
        user = pi_api.verify_token(body.access_token)
    except PiApiError:
        raise HTTPException(status_code=401, detail="Invalid Pi access token")
    uid = user["uid"]
    db.upsert_user(uid, user.get("username"), user.get("wallet_address"))
    session_token = db.create_session(uid)
    pro, tier, _ = _tier_for(uid)
    return {
        "session_token": session_token,
        "user": {"uid": uid, "username": user.get("username")},
        "pro": pro,
        "tier": tier,
    }


@app.post("/api/auth/logout")
def auth_logout(request: Request, uid: str = Depends(get_current_uid)):
    db.delete_session(get_session_token(request))
    return {"ok": True}


# ---- entitlements ---------------------------------------------------------

@app.get("/api/entitlements")
def entitlements(uid: str = Depends(get_current_uid)):
    pro, tier, ent = _tier_for(uid)
    return {
        "pro": pro,
        "tier": tier,
        "granted_at": ent["granted_at"] if ent else None,
        "payment_id": ent["payment_id"] if ent else None,
    }


@app.post("/api/entitlements/reverify")
def reverify(uid: str = Depends(get_current_uid)):
    """Rebuild Pro from Pi Platform payment records (re-derivable design)."""
    pro, _, _ = _tier_for(uid)
    restored = False
    if not pro:
        for payment in db.list_payments_for_user(uid):
            try:
                status = pi_api.get_payment_status(payment["payment_id"])
            except PiApiError:
                raise HTTPException(
                    status_code=502, detail="Pi Platform API unavailable"
                )
            completed = bool((status.get("status") or {}).get("developer_completed"))
            if completed:
                db.grant_entitlement(uid, "pro", payment["payment_id"])
                db.update_payment(
                    payment["payment_id"],
                    status="completed",
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )
                restored = True
                pro = True
                break
    return {"pro": pro, "restored": restored}


# ---- payments -------------------------------------------------------------

@app.post("/api/payments/approve")
def approve(body: ApproveRequest, uid: str = Depends(get_current_uid)):
    try:
        pi_api.approve_payment(body.payment_id)
    except PiApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    db.record_payment(
        body.payment_id,
        uid,
        settings.PRO_PRICE_PI,
        settings.PRO_MEMO,
        status="approved",
    )
    return {"ok": True}


@app.post("/api/payments/complete")
def complete(body: CompleteRequest, uid: str = Depends(get_current_uid)):
    payment = db.get_payment(body.payment_id)
    if payment is None or payment["uid"] != uid or payment["status"] != "approved":
        raise HTTPException(status_code=404, detail="No approved payment found")
    try:
        pi_api.complete_payment(body.payment_id, body.txid)
    except PiApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    db.update_payment(
        body.payment_id,
        status="completed",
        txid=body.txid,
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    db.grant_entitlement(uid, "pro", body.payment_id)
    return {"ok": True, "pro": True}


@app.post("/api/payments/cancel")
def cancel(body: CancelRequest, uid: str = Depends(get_current_uid)):
    payment = db.get_payment(body.payment_id)
    if payment is None or payment["uid"] != uid:
        raise HTTPException(status_code=404, detail="Payment not found")
    try:
        pi_api.cancel_payment(body.payment_id)
    except PiApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    db.update_payment(body.payment_id, status="cancelled")
    return {"ok": True}


@app.get("/api/payments/{payment_id}")
def get_payment(payment_id: str, uid: str = Depends(get_current_uid)):
    payment = db.get_payment(payment_id)
    if payment is None or payment["uid"] != uid:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {
        "payment_id": payment["payment_id"],
        "status": payment["status"],
        "amount": payment["amount"],
        "memo": payment["memo"],
        "txid": payment["txid"],
    }
