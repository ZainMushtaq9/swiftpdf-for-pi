"""SQLite storage (Python stdlib sqlite3 only).

State is deliberately minimal and re-derivable: Pro entitlements can always be
rebuilt from Pi Platform payment records (see /api/entitlements/reverify), so
losing this database loses nothing that cannot be reconstructed.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    username TEXT,
    wallet_address TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    amount REAL,
    memo TEXT,
    txid TEXT,
    status TEXT NOT NULL,
    created_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS entitlements (
    uid TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    payment_id TEXT,
    granted_at TEXT
);
"""


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or settings.database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path | None = None) -> None:
    """Create all tables if they do not exist."""
    with _connect(db_path) as conn:
        conn.executescript(SCHEMA)


def upsert_user(uid: str, username: str | None, wallet_address: str | None) -> None:
    now = _utcnow()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO users (uid, username, wallet_address, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET
                username = excluded.username,
                wallet_address = excluded.wallet_address,
                updated_at = excluded.updated_at
            """,
            (uid, username, wallet_address, now, now),
        )


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(uid: str) -> str:
    """Create a session and return the PLAINTEXT token (only stored hashed)."""
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=settings.SESSION_DAYS)).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, uid, expires_at, created_at)"
            " VALUES (?, ?, ?, ?)",
            (_hash_token(token), uid, expires_at, _utcnow()),
        )
    return token


def get_session_user(token: str) -> str | None:
    """Resolve a session token to a uid, or None if unknown/expired."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT uid, expires_at FROM sessions WHERE token_hash = ?",
            (_hash_token(token),),
        ).fetchone()
    if row is None:
        return None
    if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
        return None
    return row["uid"]


def delete_session(token: str) -> None:
    with _connect() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),)
        )


def record_payment(
    payment_id: str,
    uid: str,
    amount: float | None,
    memo: str | None,
    status: str,
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO payments (payment_id, uid, amount, memo, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(payment_id) DO UPDATE SET
                uid = excluded.uid,
                amount = excluded.amount,
                memo = excluded.memo,
                status = excluded.status
            """,
            (payment_id, uid, amount, memo, status, _utcnow()),
        )


def update_payment(payment_id: str, **fields: Any) -> None:
    """Update whitelisted payment columns (status, txid, completed_at)."""
    allowed = {"status", "txid", "completed_at", "amount", "memo"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    assignments = ", ".join(f"{k} = ?" for k in updates)
    with _connect() as conn:
        conn.execute(
            f"UPDATE payments SET {assignments} WHERE payment_id = ?",
            (*updates.values(), payment_id),
        )


def get_payment(payment_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM payments WHERE payment_id = ?", (payment_id,)
        ).fetchone()
    return dict(row) if row else None


def list_payments_for_user(uid: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM payments WHERE uid = ? ORDER BY created_at",
            (uid,),
        ).fetchall()
    return [dict(r) for r in rows]


def grant_entitlement(uid: str, tier: str, payment_id: str | None) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO entitlements (uid, tier, payment_id, granted_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET
                tier = excluded.tier,
                payment_id = excluded.payment_id,
                granted_at = excluded.granted_at
            """,
            (uid, tier, payment_id, _utcnow()),
        )


def get_entitlement(uid: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM entitlements WHERE uid = ?", (uid,)
        ).fetchone()
    return dict(row) if row else None


def delete_entitlement(uid: str) -> None:
    """Remove an entitlement (used by tests and the re-derive flow)."""
    with _connect() as conn:
        conn.execute("DELETE FROM entitlements WHERE uid = ?", (uid,))
