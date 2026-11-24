# SwiftPDF for Pi

**Pi Next Hackathon 2026 entry** — a privacy-first, in-browser PDF toolkit as a
Pi Network app. All 13 tools run 100% client-side: your files never leave your
device. Pi Authentication signs users in, and a one-time Pi payment unlocks
Pro (higher limits, batch processing, full OCR and conversions).

- **Deadline:** January 5, 2027, 11:59 PM PST (January 6, 2027, 07:59 UTC)
- **Budget:** $0 — free tiers only (Cloudflare Pages + Render free tier)
- **Status:** built and verified locally in mock mode (see Verification).
  No real Pi credentials exist yet — live Pi paths are untested until the
  app is registered in the Pi Developer Portal (see
  [Steps that need the user's phone](#steps-that-need-the-users-phonepi-account)).

## The 13 tools

Merge, Split, Compress, Rotate, Images to PDF, PDF to Images, PDF to Text,
Watermark, Add Page Numbers, Sign, PDF to Word (text-based), OCR (PDF &
images), HTML to PDF.

## Free vs Pro

| | Free | Pro (one-time Pi payment) |
|---|---|---|
| File size | 10 MB | 20 MB |
| Merge | up to 3 PDFs | up to 20 PDFs |
| Images to PDF | up to 5 images | up to 20 images |
| OCR | first 2 pages | first 10 pages |
| Conversions (text / Word / images) | first 5 pages | whole document |
| Single-file tools (split, rotate, …) | up to 20 pages | no page cap |
| HTML to PDF | 50 KB of HTML | 500 KB |
| Saved signature (reusable, on-device) | — | yes |

Pro price is a placeholder in config only (`PRO_PRICE_PI=1.0`) — the final
price is a product decision, not yet made. **Payments are one-time only:**
Pi subscriptions are Testnet-only and are deliberately not built.

## Architecture

```
Browser (Pi Browser / any browser)
  └─ React + Vite frontend (static, Cloudflare Pages)
       ├─ PDF tools: pdf-lib, pdf.js, Tesseract.js, docx, html2pdf.js
       │  — all processing in the browser; no file ever uploads anywhere
       ├─ Pi SDK (lazy-loaded, only on first Pi interaction)
       └─ /api calls ──▶ FastAPI backend (Render free tier)
                           ├─ SQLite (users, sessions, payments, entitlements)
                           ├─ verifies Pi access tokens via GET /v2/me
                           └─ approves/completes payments via /v2/payments/*
```

Key design rules, baked in from the Pi listing requirements:

- **Guest-first:** `Pi.authenticate` is never called on first load — visitors
  without a Pi account can browse and use the free tools. Sign-in is offered
  via a button only.
- **Pi-only auth and payments:** no email or third-party logins, no external
  payment links, no external redirects anywhere in the app.
- **Never trust the frontend user object:** the backend verifies the Pi
  access token against `GET https://api.minepi.com/v2/me` and issues its own
  session token (stored as a SHA-256 hash only).
- **Entitlements are re-derivable:** `/api/entitlements/reverify` rebuilds a
  user's Pro status from the Platform's payment records, so a lost database
  cannot permanently lose a purchase.
- **SQLite only — no Render free Postgres:** the free Postgres database
  expires 30 days after creation, inside the hackathon window.
- **Server API Key lives in the backend environment only** — never in client
  code, never in logs, never in git.
- **Sandbox/Testnet first:** the same code points at Staging or Production
  via env vars. The network choice in the Developer Portal cannot be changed
  later, so production is only switched on deliberately.
- **Mock mode is dev-only:** `VITE_PI_MOCK` (frontend) and `PI_MOCK_MODE`
  (backend) simulate Pi sign-in and payments with canned data. **Never**
  enable either in a production build — mock mode grants Pro without payment.

## Project layout

```
pi-next-pdf-app/
├── frontend/            React + Vite app (Cloudflare Pages)
│   ├── src/config/site.js      app name, 13-tool registry, Pro features
│   ├── src/pi/                 Pi SDK loader, PiContext, API client, tiers
│   ├── src/tools/pdf/          the 13 tool components + pdf helpers
│   ├── src/pages/              Home, Pro, Privacy, ToolPage, 404
│   └── public/favicon.svg
├── backend/             FastAPI app (Render free tier)
│   ├── app/main.py      10 endpoints (health, config, auth, entitlements, payments)
│   ├── app/pi_api.py    Pi Platform API client (+ mock mode)
│   ├── app/auth.py      session tokens (SHA-256 hashed)
│   ├── app/db.py        SQLite schema (users, sessions, payments, entitlements)
│   └── tests/test_api.py
├── tests/pdf.test.mjs   18 Node unit tests for the PDF logic
├── scripts/e2e-verify.mjs   Playwright end-to-end verification (mock mode)
├── assets/
│   ├── logo.svg         original mark (teal + amber — NOT Pi's logo or colors)
│   ├── PRIVACY_POLICY.md
│   └── previews/        interface screenshots for the listing
└── README.md            this file
```

The tools were adapted from the CreatorToolbox PDF toolkit
(`~/workspace/creator-toolbox/`, untouched — copied, not modified). Two real
bugs found and fixed during verification of this app:

1. **pdf.js buffer detach** (`pdfRender.js`): pdf.js transfers the PDF bytes
   to its worker, detaching the buffer — a second `getDocument` on the same
   bytes failed. `loadPdfDocument` now always passes a copy.
2. **Convert-before-count race** (6 tools): the action button was enabled as
   soon as a file was picked, but the page count is read asynchronously — a
   fast click produced a bogus "Upload a PDF first." error. Buttons now stay
   disabled until the page count is known, with a "reading…" hint.

## Quick start (local dev, mock Pi)

```bash
# Backend (venv already created; first run: python -m venv .venv && .venv/bin/pip install -r requirements.txt)
cd backend
cp .env.example .env        # set PI_MOCK_MODE=true for local dev
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
cp .env.example .env        # set VITE_PI_MOCK=true, VITE_API_URL=http://localhost:8000
npm run dev                 # http://localhost:5173
```

In mock mode, "Sign in with Pi" signs in as `@mockpioneer` and the Pro
payment completes instantly — no Pi account needed.

## Environment variables

Frontend (`frontend/.env`, all `VITE_*` are baked in at build time):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | (empty = same origin) | Backend base URL; in dev the Vite proxy handles `/api` |
| `VITE_PI_SANDBOX` | `true` | `true` = Testnet/Sandbox, `false` = Mainnet/Production |
| `VITE_PI_MOCK` | `false` | Dev-only fake `window.Pi`. **Never `true` in production.** |

Backend (`backend/.env` — see `backend/.env.example` and
`backend/README_BACKEND.md` for the full list):

| Variable | Meaning |
|---|---|
| `PI_API_KEY` | Pi Server API Key (from the Developer Portal). Placeholder until then. |
| `PI_APP_ID` | Pi App ID (from the Developer Portal). Placeholder until then. |
| `PI_NETWORK` | `staging` (Testnet) or `production` (Mainnet) |
| `PI_PLATFORM_API_BASE` | `https://api.minepi.com/v2` |
| `DATABASE_PATH` | SQLite file, e.g. `data/app.db` |
| `PRO_PRICE_PI` | Pro price in Pi (placeholder `1.0`, not final) |
| `PRO_MEMO` | Memo shown on the Pi payment |
| `SESSION_DAYS` | Session lifetime (30) |
| `CORS_ORIGINS` | Allowed frontend origins |
| `PI_MOCK_MODE` | Canned Pi responses. **Never `true` in production.** |

## Tests

```bash
npm test            # 18 Node unit tests (PDF logic, pdf-lib)
npm run test:backend  # 13 FastAPI tests (auth, payments, entitlements)
node scripts/e2e-verify.mjs   # Playwright E2E in mock mode (see below)
```

The E2E script builds nothing — build the frontend with mock env first,
then run it:

```bash
cd frontend && VITE_PI_MOCK=true VITE_API_URL=http://localhost:8000 npm run build
cd .. && node scripts/e2e-verify.mjs
```

It starts the backend (mock mode, temp DB) and `vite preview`, then drives
headless Chromium through: home (13 tool cards), all 13 tool pages, every
tool's core flow with generated fixtures, the free-tier merge cap (+ Pro
upsell), mock sign-in, mock Pro payment, the cap lift after Pro, the privacy
page, and mobile home — and saves screenshots to `assets/previews/`.

**Verification status (24 Nov 2026):** 18/18 Node unit tests pass, 13/13
backend tests pass, 35/35 Playwright E2E checks pass (including OCR, which
recognised the fixture text "HELLO WORLD 2027"). The E2E run routes the
OCR engine's CDN requests through curl — Chromium cannot reach the internet
on this VM (the egress proxy's CONNECT tunnel fails for it), while curl
reaches the CDN fine (HTTP 200); real users reach the CDN directly, so no
app change was needed. The clean production-default build contains zero
mock code (Vite tree-shakes the `VITE_PI_MOCK` branch entirely).

## Deployment ($0)

- **Frontend — Cloudflare Pages:** build command `npm --prefix frontend run build`,
  output `frontend/dist`. Set `VITE_API_URL` to the deployed backend URL and
  `VITE_PI_SANDBOX` to match the registered app's network. `VITE_PI_MOCK`
  must be unset/`false`.
- **Backend — Render free tier:** Python web service, build
  `pip install -r requirements.txt`, start
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set the env vars above
  (real `PI_API_KEY`/`PI_APP_ID`, `PI_MOCK_MODE=false`). SQLite file lives on
  Render's ephemeral disk — acceptable because entitlements are re-derivable
  from the Platform API (see Architecture). Note: Render free services sleep
  after inactivity; the first API call after sleep is slow.
- Vercel Hobby is **not** used (non-commercial terms).

## Listing assets

- **Name:** "SwiftPDF for Pi" — follows Pi's permitted trademark form
  ("\<Name> for Pi"). Using "Pi" in the app name requires executing Pi's
  **Trademark Licensing Agreement** via the Developer Portal before listing
  (a user-side step — see below).
- **Logo:** `assets/logo.svg` — an original document + checkmark mark in
  teal (#176B58) and amber (#E8A838). It does not use the Pi logo or Pi's
  brand purple.
- **Privacy policy:** `assets/PRIVACY_POLICY.md` (same text as the in-app
  `/privacy` page). Core claim: all PDF processing is client-side, files
  never upload; the server stores only the Pi username/uid, payment records
  and Pro entitlement. The OCR engine code (~10 MB) downloads from a public
  CDN on first use — the user's file still never leaves the device.
- **Previews:** `assets/previews/` — home (desktop + mobile), merge tool,
  Pro page.

## Steps that need the user's phone / Pi account

Nothing in this section can be done from this VM. All of it is the user's,
from his phone:

1. **Hackathon registration** — in the Pi Developer Web Console, Hackathon
   tab: register for Pi Next and link this app to the hackathon entry.
2. **App registration** — in the Developer Web Console, register the app
   ("SwiftPDF for Pi"). Choose the network (Staging first — this cannot be
   changed later for a registered app). Note the **App ID** and the
   **Server API Key** — they go into the backend env (`PI_APP_ID`,
   `PI_API_KEY`); never share them in chat or screenshots.
3. **Trademark Licensing Agreement** — execute it in the Developer Portal
   (required because the app name contains "Pi").
4. **App wallet** — the Developer Portal creates an app wallet for receiving
   Pi payments. **Save its passphrase on paper** — if it is lost, the Pi in
   that wallet is unrecoverable (the same lesson as the user's own lost
   wallet passphrase).
5. **Sandbox auth code** — Sandbox testing needs an auth code from the Pi
   app on his phone (Sandbox mode in the Pi Browser / Pi app settings).
6. **Real-device testing** — open the deployed app in **Pi Browser** on his
   phone: sign in with his real Pi account (Testnet), run a tool, buy Pro
   with Test-Pi, and confirm the entitlement sticks. Desktop browsers cannot
   fully substitute for this.
7. **Listing submission** — submit the app for PiNet / Mainnet listing with
   the privacy policy, logo and preview screenshots from `assets/`.

## Blocked on credentials

- No live Pi Platform API call has ever been made: auth verify, payment
  approve/complete and entitlement re-verification are code-reviewed and
  mock-tested only. First real verification needs the App ID + Server API
  Key and a Testnet run.
- The production build (`VITE_PI_SANDBOX=false`, `PI_NETWORK=production`)
  must only be made after the app is registered for Production.
- The final Pro price in Pi is undecided (`PRO_PRICE_PI=1.0` is a placeholder).

## Honest limitations

- OCR needs a ~10 MB engine download from a public CDN on first use; on a
  slow connection the first OCR run can take a minute.
- The Pi SDK is loaded from `https://sdk.minepi.com/pi-sdk.js` at runtime
  (required by Pi); if that host is unreachable, Pi features are unavailable
  but the free tools still work.
- Render's free backend sleeps after inactivity, so the first sign-in or
  payment after a quiet period is slow.
