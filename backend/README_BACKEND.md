# SwiftPDF for Pi — Backend (Pi Next 2026)

FastAPI backend for SwiftPDF for Pi: Pi Authentication plus a
one-time Pi Payment (U2A) that unlocks Pro. State lives in SQLite
(`data/app.db`) — no Postgres, no paid services.

## Run

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in PI_API_KEY / PI_APP_ID from the Pi Developer Portal
.venv/bin/uvicorn app.main:app --reload
```

API listens on http://127.0.0.1:8000. Interactive docs at `/docs`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_API_KEY` | `CHANGE_ME` | Pi Server API Key (secret, Key auth for payment calls) |
| `PI_APP_ID` | `CHANGE_ME` | Pi App ID |
| `PI_NETWORK` | `staging` | `staging` (Testnet) or `production` (Mainnet) |
| `PI_PLATFORM_API_BASE` | `https://api.minepi.com/v2` | Pi Platform API base |
| `DATABASE_PATH` | `data/app.db` | SQLite file (relative to `backend/`) |
| `PRO_PRICE_PI` | `1.0` | Pro unlock price in Pi |
| `PRO_MEMO` | `Pro unlock — SwiftPDF for Pi` | Memo on the Pi payment |
| `SESSION_DAYS` | `30` | Session lifetime in days |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Allowed frontend origins |
| `PI_MOCK_MODE` | `false` | Local testing only (see below) |

## Mock mode (local testing only)

`PI_MOCK_MODE=true` makes the backend return canned Pi responses instead of
calling the Platform API: any access token verifies as `mockpioneer`, and any
payment approves/completes. **NEVER enable it in production** — it would grant
Pro without real payment. It exists so the frontend and the full handshake can
be exercised with no Pi credentials.

## How the payment handshake works

1. Frontend: `Pi.authenticate()` → access token → `POST /api/auth/verify`.
   The backend verifies the token against `GET /v2/me` (Bearer auth) and
   **never trusts the frontend user object**. It returns a session token
   (SHA-256 hash stored, plaintext only ever returned once).
2. Frontend: `Pi.createPayment({amount: 1.0, memo: "Pro unlock — SwiftPDF for Pi"})`
   → `paymentId` → `POST /api/payments/approve`. The backend calls
   `POST /v2/payments/{id}/approve` (Key auth) and records the payment as
   `approved` in the local ledger.
3. The user signs the payment in the Pi Wallet; the frontend receives a
   `txid` → `POST /api/payments/complete`. The backend calls
   `POST /v2/payments/{id}/complete` with the txid (Key auth), marks the
   payment `completed`, and grants the Pro entitlement.
4. `GET /api/entitlements` reports the current tier. A payment can be
   abandoned with `POST /api/payments/cancel`.

Errors: bad/missing session → 401; unknown payment → 404; Pi Platform API
failure → 502. The API key never appears in any response or log.

## How entitlements are re-derived

Entitlements are a cache, not the source of truth. The source of truth is the
Pi Platform's payment records. If the database is lost or an entitlement row
is missing, `POST /api/entitlements/reverify` re-checks every recorded
payment for the user via `GET /v2/payments/{id}` and re-grants Pro for any
payment whose status is `developer_completed`. State is minimal and
re-derivable by design.

## Tests

```bash
.venv/bin/python -m pytest
```

All Platform API calls are monkeypatched in tests — no real HTTP.
