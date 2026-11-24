# SwiftPDF for Pi — Backend (Cloudflare Worker + D1)

JavaScript rewrite of the FastAPI backend in `../backend` (kept as
reference). Drop-in replacement: same 10 routes, same request/response
JSON, same error contract (401 bad session, 404 unknown payment, 502 Pi
Platform failure, FastAPI-shaped `{"detail": ...}` errors).

Why Workers: the FastAPI backend could not be hosted free anywhere we
tried — Render's workspace is suspended for non-payment, Koyeb offers
no service creation to new signups, Hugging Face Spaces needs PRO for
Docker/CPU and ZeroGPU only runs Gradio demo apps, and PythonAnywhere's
free outbound allowlist blocks `api.minepi.com`. Cloudflare Workers +
D1 are free, never sleep, and live in the same account as the Pages
frontend.

## Layout

```
worker/
├── src/index.js            the Worker (zero dependencies)
├── migrations/0001_init.sql  D1 schema (users, sessions, payments, entitlements)
├── tests/worker.test.mjs   27 tests (node:test + node:sqlite D1 shim, stubbed Pi API)
├── wrangler.toml           Worker + D1 binding + non-secret vars
└── package.json
```

## Local dev

```bash
npm install
npm test                                   # 27/27, no network, no wrangler needed
npm run migrate:local                      # create the local D1 tables
npx wrangler dev --local --var PI_MOCK_MODE:true   # mock Pi (no credentials)
```

Mock mode (`PI_MOCK_MODE=true`) verifies any token as `@mockpioneer`
and completes any payment — **local testing only, never in
production** (it would grant Pro without payment). With mock mode off,
the Worker calls the real Pi Platform API (`https://api.minepi.com/v2`).

## Deploy (needs Cloudflare auth — see blocker below)

Account: Zainmushtaq3399@gmail.com (`4fbf954a937c1e97b747e42da1eb1c40`),
workers.dev subdomain `creator-toolbox`, so the Worker URL will be
`https://swiftpdf-api.creator-toolbox.workers.dev`.

```bash
export CLOUDFLARE_API_TOKEN=<token>          # transient only, never stored
export CLOUDFLARE_ACCOUNT_ID=4fbf954a937c1e97b747e42da1eb1c40  # token lacks Memberships:Read
npx wrangler d1 create swiftpdf              # paste the returned id into wrangler.toml
npm run migrate                              # apply 0001_init.sql to remote D1
echo -n "CHANGE_ME" | npx wrangler secret put PI_API_KEY    # real key once the app is registered
echo -n "CHANGE_ME" | npx wrangler secret put PI_APP_ID     # real id once the app is registered
npx wrangler deploy
curl https://swiftpdf-api.creator-toolbox.workers.dev/api/health
```

Env vars (non-secret, in `wrangler.toml`): `PI_NETWORK=staging`,
`PI_PLATFORM_API_BASE=https://api.minepi.com/v2`, `PRO_PRICE_PI=1.0`
(placeholder — final price undecided), `PRO_MEMO`, `SESSION_DAYS=30`,
`CORS_ORIGINS=https://swiftpdf-for-pi.pages.dev,http://localhost:5173,http://localhost:4173`,
`PI_MOCK_MODE=false`.

When the app is registered in the Pi Developer Portal, replace the two
`CHANGE_ME` secrets with the real Server API Key and App ID
(`wrangler secret put`), no redeploy needed. Switching to Mainnet is
`PI_NETWORK=production` + a redeploy (only after the app is registered
for Production — the network choice in the Portal is permanent).

## Blocker (24 Nov 2026)

**No Cloudflare auth exists on this VM.** `wrangler whoami` reports
"not authenticated", there is no `~/.wrangler`, and the Cloudflare
connector is `not_connected`. The API token used for CreatorToolbox
(`creator-toolbox-deploy`, Nov 2026) was used transiently and never
stored. To deploy, either supply that token again (transiently, via
`CLOUDFLARE_API_TOKEN`) or run `wrangler login` in a browser
(OAuth timed out 3× in Nov 2026 — the token route worked). The build,
tests and local smoke test are all done; only auth is missing.

## Notes

- The frontend needs **no changes**: it calls the same `/api/*` paths
  via `VITE_API_URL` — point that at the deployed Worker URL at build
  time (see `../README.md` Deployment).
- `pro_price_pi` serialises as JSON `1` (JS numbers have no `.0`);
  the frontend does `Number(...)` on it, so this is a no-op.
- D1 is real SQLite: the same `ON CONFLICT ... DO UPDATE` upserts as
  the FastAPI backend, and entitlements stay re-derivable via
  `POST /api/entitlements/reverify`.
- Sessions are SHA-256-hashed tokens (plaintext returned once at
  login), 30-day expiry, same as the FastAPI backend.
