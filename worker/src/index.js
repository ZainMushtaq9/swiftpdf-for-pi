/**
 * SwiftPDF for Pi — backend as a Cloudflare Worker (JS + D1).
 *
 * Drop-in replacement for the FastAPI backend in ../backend (kept as
 * reference). Same routes, same request/response JSON, same error
 * contract: bad/missing session -> 401; unknown payment -> 404; Pi
 * Platform API failure -> 502. Errors use FastAPI's {"detail": ...}
 * shape because the frontend reads `data.detail`.
 *
 * Endpoints (all JSON):
 * - GET  /api/health                  public
 * - GET  /api/config                  public, no secrets
 * - POST /api/auth/verify             exchange a Pi access token for a session
 * - POST /api/auth/logout             auth required
 * - GET  /api/entitlements            auth required
 * - POST /api/entitlements/reverify   auth required (rebuilds Pro from Platform records)
 * - POST /api/payments/approve        auth required
 * - POST /api/payments/complete       auth required
 * - POST /api/payments/cancel         auth required
 * - GET  /api/payments/{payment_id}   auth required
 *
 * The Pi Server API Key never appears in any response or log line.
 */

// ---- config (mirrors backend/app/config.py defaults) ----------------------

function envBool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envFloat(env, name, fallback) {
  const v = Number.parseFloat(env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function envInt(env, name, fallback) {
  const v = Number.parseInt(env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function loadSettings(env) {
  const corsRaw =
    env.CORS_ORIGINS || "http://localhost:5173,http://localhost:4173";
  return {
    PI_API_KEY: env.PI_API_KEY || "CHANGE_ME",
    PI_APP_ID: env.PI_APP_ID || "CHANGE_ME",
    PI_NETWORK: env.PI_NETWORK || "staging",
    PI_PLATFORM_API_BASE:
      env.PI_PLATFORM_API_BASE || "https://api.minepi.com/v2",
    PRO_PRICE_PI: envFloat(env, "PRO_PRICE_PI", 1.0),
    PRO_MEMO: env.PRO_MEMO || "Pro unlock — SwiftPDF for Pi",
    SESSION_DAYS: envInt(env, "SESSION_DAYS", 30),
    CORS_ORIGINS: corsRaw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    // WARNING: mock mode returns canned Pi responses and must NEVER be
    // enabled in production — it would grant Pro without real payment.
    PI_MOCK_MODE: envBool(env, "PI_MOCK_MODE", false),
  };
}

// ---- errors ---------------------------------------------------------------

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

class PiApiError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ---- helpers --------------------------------------------------------------

function utcnow() {
  return new Date().toISOString();
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function errorResponse(status, detail) {
  // FastAPI shape: {"detail": "..."} — the frontend reads data.detail.
  return jsonResponse({ detail }, status);
}

async function readJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(422, "Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(422, "Invalid JSON body");
  }
  return body;
}

function requireString(body, field) {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(422, `Field required: ${field}`);
  }
  return value;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken() {
  // Same shape as Python secrets.token_urlsafe(32): 32 random bytes,
  // base64url-encoded, no padding (43 chars).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- D1 storage (mirrors backend/app/db.py) -------------------------------

async function upsertUser(db, uid, username, walletAddress) {
  const now = utcnow();
  await db
    .prepare(
      `INSERT INTO users (uid, username, wallet_address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         username = excluded.username,
         wallet_address = excluded.wallet_address,
         updated_at = excluded.updated_at`,
    )
    .bind(uid, username ?? null, walletAddress ?? null, now, now)
    .run();
}

async function createSession(db, uid, sessionDays) {
  const token = randomToken();
  const expiresAt = new Date(
    Date.now() + sessionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, uid, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(await sha256Hex(token), uid, expiresAt, utcnow())
    .run();
  return token;
}

async function getSessionUser(db, token) {
  const row = await db
    .prepare("SELECT uid, expires_at FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row.uid;
}

async function deleteSession(db, token) {
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

async function recordPayment(db, paymentId, uid, amount, memo, status) {
  await db
    .prepare(
      `INSERT INTO payments (payment_id, uid, amount, memo, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_id) DO UPDATE SET
         uid = excluded.uid,
         amount = excluded.amount,
         memo = excluded.memo,
         status = excluded.status`,
    )
    .bind(paymentId, uid, amount ?? null, memo ?? null, status, utcnow())
    .run();
}

async function updatePayment(db, paymentId, fields) {
  const allowed = new Set(["status", "txid", "completed_at", "amount", "memo"]);
  const updates = Object.entries(fields).filter(([k]) => allowed.has(k));
  if (updates.length === 0) return;
  const assignments = updates.map(([k]) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE payments SET ${assignments} WHERE payment_id = ?`)
    .bind(...updates.map(([, v]) => v ?? null), paymentId)
    .run();
}

async function getPayment(db, paymentId) {
  return (
    (await db
      .prepare("SELECT * FROM payments WHERE payment_id = ?")
      .bind(paymentId)
      .first()) ?? null
  );
}

async function listPaymentsForUser(db, uid) {
  const { results } = await db
    .prepare("SELECT * FROM payments WHERE uid = ? ORDER BY created_at")
    .bind(uid)
    .all();
  return results || [];
}

async function grantEntitlement(db, uid, tier, paymentId) {
  await db
    .prepare(
      `INSERT INTO entitlements (uid, tier, payment_id, granted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         tier = excluded.tier,
         payment_id = excluded.payment_id,
         granted_at = excluded.granted_at`,
    )
    .bind(uid, tier, paymentId ?? null, utcnow())
    .run();
}

async function getEntitlement(db, uid) {
  return (
    (await db
      .prepare("SELECT * FROM entitlements WHERE uid = ?")
      .bind(uid)
      .first()) ?? null
  );
}

async function tierFor(db, uid) {
  const ent = await getEntitlement(db, uid);
  if (ent && ent.tier === "pro") return { pro: true, tier: "pro", ent };
  return { pro: false, tier: "free", ent };
}

// ---- Pi Platform API client (mirrors backend/app/pi_api.py) ---------------

const PI_TIMEOUT_MS = 15000;

const MOCK_USER = {
  uid: "mock-user-uid",
  username: "mockpioneer",
  wallet_address: "G-MOCK-WALLET",
};

async function piRequest(settings, method, path, { auth, json = null } = {}) {
  const url = `${settings.PI_PLATFORM_API_BASE.replace(/\/$/, "")}${path}`;
  const init = {
    method,
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(PI_TIMEOUT_MS),
  };
  if (json !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    // Never include the response body or tokens in the message.
    throw new PiApiError(`Pi Platform API unreachable: ${err.message}`);
  }
  if (resp.status !== 200) {
    throw new PiApiError(
      `Pi Platform API returned HTTP ${resp.status} for ${method} ${path}`,
      resp.status,
    );
  }
  let data;
  try {
    data = await resp.json();
  } catch {
    throw new PiApiError("Pi Platform API returned non-JSON response");
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? data
    : { value: data };
}

async function verifyToken(settings, accessToken) {
  if (settings.PI_MOCK_MODE) {
    console.warn("PI_MOCK_MODE is ON: verify_token returning canned user");
    return { ...MOCK_USER };
  }
  const data = await piRequest(settings, "GET", "/me", {
    auth: `Bearer ${accessToken}`,
  });
  const { uid, username } = data;
  if (!uid || !username) {
    throw new PiApiError("Pi Platform /me response missing uid/username");
  }
  return { uid, username, wallet_address: data.wallet_address ?? null };
}

async function approvePayment(settings, paymentId) {
  if (settings.PI_MOCK_MODE) {
    console.warn("PI_MOCK_MODE is ON: approve_payment returning canned ok");
    return { ok: true };
  }
  return piRequest(settings, "POST", `/payments/${paymentId}/approve`, {
    auth: `Key ${settings.PI_API_KEY}`,
  });
}

async function completePayment(settings, paymentId, txid) {
  if (settings.PI_MOCK_MODE) {
    console.warn("PI_MOCK_MODE is ON: complete_payment returning canned ok");
    return { ok: true };
  }
  return piRequest(settings, "POST", `/payments/${paymentId}/complete`, {
    auth: `Key ${settings.PI_API_KEY}`,
    json: { txid },
  });
}

async function cancelPayment(settings, paymentId) {
  if (settings.PI_MOCK_MODE) {
    console.warn("PI_MOCK_MODE is ON: cancel_payment returning canned ok");
    return { ok: true };
  }
  return piRequest(settings, "POST", `/payments/${paymentId}/cancel`, {
    auth: `Key ${settings.PI_API_KEY}`,
  });
}

async function getPaymentStatus(settings, paymentId) {
  if (settings.PI_MOCK_MODE) {
    console.warn(
      "PI_MOCK_MODE is ON: get_payment_status returning canned completed",
    );
    return { identifier: paymentId, status: { developer_completed: true } };
  }
  return piRequest(settings, "GET", `/payments/${paymentId}`, {
    auth: `Key ${settings.PI_API_KEY}`,
  });
}

// ---- auth (mirrors backend/app/auth.py) -----------------------------------

function getSessionToken(request) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or invalid session token");
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    throw new HttpError(401, "Missing or invalid session token");
  }
  return token;
}

async function getCurrentUid(db, request) {
  const token = getSessionToken(request);
  const uid = await getSessionUser(db, token);
  if (uid === null) {
    throw new HttpError(401, "Session expired or invalid");
  }
  return uid;
}

// ---- CORS (mirrors FastAPI CORSMiddleware: allow_origins, credentials,
// allow_methods ["*"], allow_headers ["*"]) ---------------------------------

function corsHeadersFor(request, settings) {
  const origin = request.headers.get("Origin");
  if (!origin || !settings.CORS_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function handlePreflight(request, settings) {
  const cors = corsHeadersFor(request, settings);
  if (!cors["Access-Control-Allow-Origin"]) {
    return new Response(null, { status: 200 });
  }
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  const requestedHeaders = request.headers.get(
    "Access-Control-Request-Headers",
  );
  return new Response(null, {
    status: 200,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": requestedMethod || "*",
      "Access-Control-Allow-Headers": requestedHeaders || "*",
      "Access-Control-Max-Age": "600",
    },
  });
}

// ---- route handlers -------------------------------------------------------

async function handleHealth(settings) {
  return jsonResponse({
    status: "ok",
    network: settings.PI_NETWORK,
    mock_mode: settings.PI_MOCK_MODE,
  });
}

async function handleConfig(settings) {
  return jsonResponse({
    pro_price_pi: settings.PRO_PRICE_PI,
    pro_memo: settings.PRO_MEMO,
    network: settings.PI_NETWORK,
    app_name: "SwiftPDF for Pi",
  });
}

async function handleAuthVerify(db, settings, request) {
  const body = await readJsonBody(request);
  const accessToken = requireString(body, "access_token");
  let user;
  try {
    user = await verifyToken(settings, accessToken);
  } catch (err) {
    if (err instanceof PiApiError) {
      throw new HttpError(401, "Invalid Pi access token");
    }
    throw err;
  }
  const uid = user.uid;
  await upsertUser(db, uid, user.username ?? null, user.wallet_address ?? null);
  const sessionToken = await createSession(db, uid, settings.SESSION_DAYS);
  const { pro, tier } = await tierFor(db, uid);
  return jsonResponse({
    session_token: sessionToken,
    user: { uid, username: user.username ?? null },
    pro,
    tier,
  });
}

async function handleAuthLogout(db, request) {
  await getCurrentUid(db, request); // validates the session
  await deleteSession(db, getSessionToken(request));
  return jsonResponse({ ok: true });
}

async function handleEntitlements(db, request) {
  const uid = await getCurrentUid(db, request);
  const { pro, tier, ent } = await tierFor(db, uid);
  return jsonResponse({
    pro,
    tier,
    granted_at: ent ? ent.granted_at : null,
    payment_id: ent ? ent.payment_id : null,
  });
}

async function handleReverify(db, settings, request) {
  const uid = await getCurrentUid(db, request);
  let { pro } = await tierFor(db, uid);
  let restored = false;
  if (!pro) {
    for (const payment of await listPaymentsForUser(db, uid)) {
      let status;
      try {
        status = await getPaymentStatus(settings, payment.payment_id);
      } catch (err) {
        if (err instanceof PiApiError) {
          throw new HttpError(502, "Pi Platform API unavailable");
        }
        throw err;
      }
      const completed = Boolean(
        (status.status || {}).developer_completed,
      );
      if (completed) {
        await grantEntitlement(db, uid, "pro", payment.payment_id);
        await updatePayment(db, payment.payment_id, {
          status: "completed",
          completed_at: utcnow(),
        });
        restored = true;
        pro = true;
        break;
      }
    }
  }
  return jsonResponse({ pro, restored });
}

async function handleApprove(db, settings, request) {
  const uid = await getCurrentUid(db, request);
  const body = await readJsonBody(request);
  const paymentId = requireString(body, "payment_id");
  try {
    await approvePayment(settings, paymentId);
  } catch (err) {
    if (err instanceof PiApiError) {
      throw new HttpError(502, err.message);
    }
    throw err;
  }
  await recordPayment(
    db,
    paymentId,
    uid,
    settings.PRO_PRICE_PI,
    settings.PRO_MEMO,
    "approved",
  );
  return jsonResponse({ ok: true });
}

async function handleComplete(db, settings, request) {
  const uid = await getCurrentUid(db, request);
  const body = await readJsonBody(request);
  const paymentId = requireString(body, "payment_id");
  const txid = requireString(body, "txid");
  const payment = await getPayment(db, paymentId);
  if (!payment || payment.uid !== uid || payment.status !== "approved") {
    throw new HttpError(404, "No approved payment found");
  }
  try {
    await completePayment(settings, paymentId, txid);
  } catch (err) {
    if (err instanceof PiApiError) {
      throw new HttpError(502, err.message);
    }
    throw err;
  }
  await updatePayment(db, paymentId, {
    status: "completed",
    txid,
    completed_at: utcnow(),
  });
  await grantEntitlement(db, uid, "pro", paymentId);
  return jsonResponse({ ok: true, pro: true });
}

async function handleCancel(db, settings, request) {
  const uid = await getCurrentUid(db, request);
  const body = await readJsonBody(request);
  const paymentId = requireString(body, "payment_id");
  const payment = await getPayment(db, paymentId);
  if (!payment || payment.uid !== uid) {
    throw new HttpError(404, "Payment not found");
  }
  try {
    await cancelPayment(settings, paymentId);
  } catch (err) {
    if (err instanceof PiApiError) {
      throw new HttpError(502, err.message);
    }
    throw err;
  }
  await updatePayment(db, paymentId, { status: "cancelled" });
  return jsonResponse({ ok: true });
}

async function handleGetPayment(db, request, paymentId) {
  const uid = await getCurrentUid(db, request);
  const payment = await getPayment(db, paymentId);
  if (!payment || payment.uid !== uid) {
    throw new HttpError(404, "Payment not found");
  }
  return jsonResponse({
    payment_id: payment.payment_id,
    status: payment.status,
    amount: payment.amount,
    memo: payment.memo,
    txid: payment.txid,
  });
}

// ---- router ---------------------------------------------------------------

const ROUTES = [
  { method: "GET", path: "/api/health", handler: (c) => handleHealth(c.settings) },
  { method: "GET", path: "/api/config", handler: (c) => handleConfig(c.settings) },
  {
    method: "POST",
    path: "/api/auth/verify",
    handler: (c) => handleAuthVerify(c.db, c.settings, c.request),
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    handler: (c) => handleAuthLogout(c.db, c.request),
  },
  {
    method: "GET",
    path: "/api/entitlements",
    handler: (c) => handleEntitlements(c.db, c.request),
  },
  {
    method: "POST",
    path: "/api/entitlements/reverify",
    handler: (c) => handleReverify(c.db, c.settings, c.request),
  },
  {
    method: "POST",
    path: "/api/payments/approve",
    handler: (c) => handleApprove(c.db, c.settings, c.request),
  },
  {
    method: "POST",
    path: "/api/payments/complete",
    handler: (c) => handleComplete(c.db, c.settings, c.request),
  },
  {
    method: "POST",
    path: "/api/payments/cancel",
    handler: (c) => handleCancel(c.db, c.settings, c.request),
  },
];

function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.path === pathname) {
      return route.method === method ? route : { methodMismatch: true };
    }
  }
  const paymentMatch = pathname.match(/^\/api\/payments\/([^/]+)$/);
  if (paymentMatch) {
    if (method !== "GET") return { methodMismatch: true };
    return {
      handler: (c) => handleGetPayment(c.db, c.request, paymentMatch[1]),
    };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const settings = loadSettings(env);
    const db = env.DB;

    // Preflight first, before routing.
    if (request.method === "OPTIONS") {
      return handlePreflight(request, settings);
    }

    const cors = corsHeadersFor(request, settings);
    const withCors = (response) => {
      if (Object.keys(cors).length === 0) return response;
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    try {
      const url = new URL(request.url);
      const route = matchRoute(request.method, url.pathname);
      if (!route) return withCors(errorResponse(404, "Not Found"));
      if (route.methodMismatch) {
        return withCors(errorResponse(405, "Method Not Allowed"));
      }
      const response = await route.handler({ db, settings, request, ctx });
      return withCors(response);
    } catch (err) {
      if (err instanceof HttpError) {
        return withCors(errorResponse(err.status, err.detail));
      }
      console.error("Unhandled error:", err);
      return withCors(errorResponse(500, "Internal server error"));
    }
  },
};
