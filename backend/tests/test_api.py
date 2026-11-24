"""API tests for the SwiftPDF for Pi backend (Pi Next 2026).

All Pi Platform API calls are monkeypatched — no real HTTP leaves this
process. Each test gets a fresh temporary SQLite database.
"""

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import settings
from app.main import app
from app.pi_api import PiApiError

TEST_USER = {
    "uid": "test-user-uid",
    "username": "testpioneer",
    "wallet_address": "G-TEST-WALLET",
}

OTHER_USER = {
    "uid": "other-user-uid",
    "username": "otherpioneer",
    "wallet_address": "G-OTHER-WALLET",
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """TestClient backed by a temporary database, mock mode off."""
    monkeypatch.setattr(settings, "DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(settings, "PI_MOCK_MODE", False)
    with TestClient(app) as test_client:
        yield test_client


def _login(client, monkeypatch, user=TEST_USER):
    """Log in as `user` (mocked Pi verification); returns auth headers."""
    monkeypatch.setattr(
        "app.pi_api.verify_token", lambda token: dict(user)
    )
    resp = client.post("/api/auth/verify", json={"access_token": "any-token"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["session_token"]
    return {"Authorization": f"Bearer {token}"}


def _mock_payment_calls(monkeypatch, fail_approve=False):
    def approve(payment_id):
        if fail_approve:
            raise PiApiError("Platform down")
        return {"ok": True}

    monkeypatch.setattr("app.pi_api.approve_payment", approve)
    monkeypatch.setattr(
        "app.pi_api.complete_payment", lambda pid, txid: {"ok": True}
    )
    monkeypatch.setattr("app.pi_api.cancel_payment", lambda pid: {"ok": True})


# ---- public endpoints -----------------------------------------------------

def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["network"] == "staging"
    assert body["mock_mode"] is False


def test_config_has_no_secrets(client):
    resp = client.get("/api/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pro_price_pi"] == 1.0
    assert body["pro_memo"] == "Pro unlock — SwiftPDF for Pi"
    assert body["network"] == "staging"
    assert body["app_name"] == "SwiftPDF for Pi"
    raw = resp.text.lower()
    assert "change_me" not in raw
    assert "api_key" not in raw
    assert "pi_api_key" not in raw


# ---- auth -----------------------------------------------------------------

def test_auth_verify_success(client, monkeypatch):
    monkeypatch.setattr(
        "app.pi_api.verify_token", lambda token: dict(TEST_USER)
    )
    resp = client.post("/api/auth/verify", json={"access_token": "valid-token"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["session_token"]
    assert body["user"] == {"uid": "test-user-uid", "username": "testpioneer"}
    assert body["pro"] is False
    assert body["tier"] == "free"


def test_auth_verify_bad_token_401(client, monkeypatch):
    def bad_token(token):
        raise PiApiError("bad token", status_code=401)

    monkeypatch.setattr("app.pi_api.verify_token", bad_token)
    resp = client.post("/api/auth/verify", json={"access_token": "bogus"})
    assert resp.status_code == 401


def test_logout_invalidates_token(client, monkeypatch):
    headers = _login(client, monkeypatch)
    assert client.get("/api/entitlements", headers=headers).status_code == 200
    resp = client.post("/api/auth/logout", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert client.get("/api/entitlements", headers=headers).status_code == 401


# ---- entitlements ---------------------------------------------------------

def test_entitlements_free_by_default(client, monkeypatch):
    headers = _login(client, monkeypatch)
    resp = client.get("/api/entitlements", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "pro": False,
        "tier": "free",
        "granted_at": None,
        "payment_id": None,
    }


def test_entitlements_401_without_session(client):
    assert client.get("/api/entitlements").status_code == 401


def test_reverify_restores_pro_after_entitlement_deleted(client, monkeypatch):
    """Re-derivable proof: Pro can be rebuilt from Platform payment records."""
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch)
    assert client.post(
        "/api/payments/approve", json={"payment_id": "pay-1"}, headers=headers
    ).status_code == 200
    assert client.post(
        "/api/payments/complete",
        json={"payment_id": "pay-1", "txid": "tx-1"},
        headers=headers,
    ).status_code == 200
    assert client.get("/api/entitlements", headers=headers).json()["pro"] is True

    # Simulate a lost entitlement row (e.g. database rebuilt from scratch).
    db.delete_entitlement("test-user-uid")
    assert client.get("/api/entitlements", headers=headers).json()["pro"] is False

    monkeypatch.setattr(
        "app.pi_api.get_payment_status",
        lambda pid: {"identifier": pid, "status": {"developer_completed": True}},
    )
    resp = client.post("/api/entitlements/reverify", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"pro": True, "restored": True}
    assert client.get("/api/entitlements", headers=headers).json()["pro"] is True


# ---- payments -------------------------------------------------------------

def test_full_payment_flow_approve_complete_pro(client, monkeypatch):
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch)

    resp = client.post(
        "/api/payments/approve", json={"payment_id": "pay-1"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    resp = client.post(
        "/api/payments/complete",
        json={"payment_id": "pay-1", "txid": "tx-abc"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "pro": True}

    ent = client.get("/api/entitlements", headers=headers).json()
    assert ent["pro"] is True
    assert ent["tier"] == "pro"
    assert ent["payment_id"] == "pay-1"
    assert ent["granted_at"]

    payment = client.get("/api/payments/pay-1", headers=headers).json()
    assert payment["status"] == "completed"
    assert payment["txid"] == "tx-abc"
    assert payment["amount"] == 1.0
    assert payment["memo"] == "Pro unlock — SwiftPDF for Pi"


def test_complete_without_prior_approve_404(client, monkeypatch):
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch)
    resp = client.post(
        "/api/payments/complete",
        json={"payment_id": "pay-never-approved", "txid": "tx-1"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_cancel_marks_payment_cancelled(client, monkeypatch):
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch)
    assert client.post(
        "/api/payments/approve", json={"payment_id": "pay-2"}, headers=headers
    ).status_code == 200
    resp = client.post(
        "/api/payments/cancel", json={"payment_id": "pay-2"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    payment = client.get("/api/payments/pay-2", headers=headers).json()
    assert payment["status"] == "cancelled"
    # Cancelling must not grant Pro.
    assert client.get("/api/entitlements", headers=headers).json()["pro"] is False


def test_approve_platform_failure_502(client, monkeypatch):
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch, fail_approve=True)
    resp = client.post(
        "/api/payments/approve", json={"payment_id": "pay-3"}, headers=headers
    )
    assert resp.status_code == 502


def test_payment_lookup_other_user_404(client, monkeypatch):
    headers = _login(client, monkeypatch)
    _mock_payment_calls(monkeypatch)
    assert client.post(
        "/api/payments/approve", json={"payment_id": "pay-4"}, headers=headers
    ).status_code == 200
    other_headers = _login(client, monkeypatch, user=OTHER_USER)
    assert client.get("/api/payments/pay-4", headers=other_headers).status_code == 404
    assert client.get("/api/payments/pay-unknown", headers=headers).status_code == 404
