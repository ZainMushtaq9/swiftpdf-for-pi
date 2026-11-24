-- SwiftPDF for Pi — D1 schema (mirrors backend/app/db.py exactly).
-- State is minimal and re-derivable: Pro entitlements can always be rebuilt
-- from Pi Platform payment records (see POST /api/entitlements/reverify).
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
