/**
 * Worker tests for the SwiftPDF for Pi backend (Cloudflare Worker + D1).
 *
 * Mirrors backend/tests/test_api.py (13 FastAPI tests) plus CORS, mock
 * mode, session expiry and routing tests. No wrangler needed: the Worker
 * is imported directly, D1 is emulated over Node's built-in SQLite
 * (node:sqlite, real SQL against an in-memory database), and the Pi
 * Platform API is stubbed by replacing global fetch — no real HTTP
 * leaves this process.
 *
 * Run: npm test   (node --test tests/worker.test.mjs)
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import worker from "../src/index.js";

const SCHEMA = readFileSync(
  new URL("../migrations/0001_init.sql", import.meta.url),
  "utf-8",
);

const TEST_USER = {
  uid: "test-user-uid",
  username: "testpioneer",
  wallet_address: "G-TEST-WALLET",
};

const OTHER_USER = {
  uid: "other-user-uid",
  username: "otherpioneer",
  wallet_address: "G-OTHER-WALLET",
};

// ---- minimal D1 emulation over node:sqlite --------------------------------

class D1Shim {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(SCHEMA);
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    const makeResult = (params) => ({
      run: () => {
        stmt.run(...params);
        return { success: true };
      },
      first: () => stmt.get(...params) ?? null,
      all: () => ({ results: stmt.all(...params) }),
    });
    return {
      bind: (...params) => makeResult(params),
      // No-parameter statements may call these directly.
      ...makeResult([]),
    };
  }

  // Test helper: run raw SQL directly (e.g. delete an entitlement row).
  exec(sql, ...params) {
    this.db.prepare(sql).run(...params);
  }
}

// ---- Pi Platform API stub --------------------------------------------------

const realFetch = globalThis.fetch;

function installPiStub({ failApprove = false, meMissingFields = false } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method || "GET";
    const auth = (init.headers && init.headers.Authorization) || "";

    if (method === "GET" && pathname === "/v2/me") {
      if (auth === "Bearer bogus") {
        return Response.json({ error: "invalid token" }, { status: 401 });
      }
      if (meMissingFields) {
        return Response.json({ username: "no-uid-here" });
      }
      const user = auth === "Bearer other-token" ? OTHER_USER : TEST_USER;
      return Response.json(user);
    }
    if (method === "POST" && pathname.endsWith("/approve")) {
      if (failApprove) {
        return Response.json({ error: "platform down" }, { status: 500 });
      }
      return Response.json({ ok: true });
    }
    if (method === "POST" && pathname.endsWith("/complete")) {
      return Response.json({ ok: true });
    }
    if (method === "POST" && pathname.endsWith("/cancel")) {
      return Response.json({ ok: true });
    }
    if (method === "GET" && pathname.startsWith("/v2/payments/")) {
      return Response.json({
        identifier: pathname.split("/").pop(),
        status: { developer_completed: true },
      });
    }
    throw new Error(`Pi stub: unexpected call ${method} ${pathname}`);
  };
}

// ---- test harness -----------------------------------------------------------

let db;
let env;

function makeEnv(overrides = {}) {
  return {
    DB: db,
    PI_NETWORK: "staging",
    PI_PLATFORM_API_BASE: "https://api.minepi.com/v2",
    PRO_PRICE_PI: "1.0",
    PRO_MEMO: "Pro unlock — SwiftPDF for Pi",
    SESSION_DAYS: "30",
    CORS_ORIGINS:
      "https://swiftpdf-for-pi.pages.dev,http://localhost:5173,http://localhost:4173",
    PI_MOCK_MODE: "false",
    PI_API_KEY: "test-server-key",
    PI_APP_ID: "test-app-id",
    ...overrides,
  };
}

async function call(method, path, { body = null, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(
    new Request(`https://swiftpdf-api.test${path}`, init),
    env,
  );
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON (e.g. empty preflight) — leave data as {}.
  }
  return { status: res.status, headers: res.headers, data };
}

async function login(token = "valid-token") {
  const { status, data } = await call("POST", "/api/auth/verify", {
    body: { access_token: token },
  });
  assert.equal(status, 200, JSON.stringify(data));
  return { Authorization: `Bearer ${data.session_token}` };
}

beforeEach(() => {
  db = new D1Shim();
  env = makeEnv();
  installPiStub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- public endpoints --------------------------------------------------------

describe("public endpoints", () => {
  it("health returns status, network and mock_mode", async () => {
    const { status, data } = await call("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.status, "ok");
    assert.equal(data.network, "staging");
    assert.equal(data.mock_mode, false);
  });

  it("config returns price/memo/network/name and no secrets", async () => {
    const { status, data } = await call("GET", "/api/config");
    assert.equal(status, 200);
    assert.equal(data.pro_price_pi, 1.0);
    assert.equal(data.pro_memo, "Pro unlock — SwiftPDF for Pi");
    assert.equal(data.network, "staging");
    assert.equal(data.app_name, "SwiftPDF for Pi");
    const raw = JSON.stringify(data).toLowerCase();
    assert.ok(!raw.includes("change_me"));
    assert.ok(!raw.includes("api_key"));
  });

  it("unknown route returns 404 with FastAPI-shaped detail", async () => {
    const { status, data } = await call("GET", "/api/nope");
    assert.equal(status, 404);
    assert.equal(typeof data.detail, "string");
  });

  it("wrong method on a known path returns 405", async () => {
    const { status } = await call("POST", "/api/health");
    assert.equal(status, 405);
  });
});

// ---- auth --------------------------------------------------------------------

describe("auth", () => {
  it("verify success returns session, user, free tier", async () => {
    const { status, data } = await call("POST", "/api/auth/verify", {
      body: { access_token: "valid-token" },
    });
    assert.equal(status, 200);
    assert.ok(data.session_token);
    assert.deepEqual(data.user, {
      uid: "test-user-uid",
      username: "testpioneer",
    });
    assert.equal(data.pro, false);
    assert.equal(data.tier, "free");
  });

  it("verify with a bad token returns 401", async () => {
    const { status } = await call("POST", "/api/auth/verify", {
      body: { access_token: "bogus" },
    });
    assert.equal(status, 401);
  });

  it("verify with /me missing uid returns 401", async () => {
    installPiStub({ meMissingFields: true });
    const { status } = await call("POST", "/api/auth/verify", {
      body: { access_token: "valid-token" },
    });
    assert.equal(status, 401);
  });

  it("verify with a missing access_token returns 422", async () => {
    const { status } = await call("POST", "/api/auth/verify", { body: {} });
    assert.equal(status, 422);
  });

  it("logout invalidates the session token", async () => {
    const headers = await login();
    assert.equal((await call("GET", "/api/entitlements", { headers })).status, 200);
    const { status, data } = await call("POST", "/api/auth/logout", { headers });
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true });
    assert.equal((await call("GET", "/api/entitlements", { headers })).status, 401);
  });

  it("an expired session returns 401", async () => {
    const headers = await login();
    // Age the session row past expiry directly in the DB.
    db.exec(
      "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'",
    );
    assert.equal((await call("GET", "/api/entitlements", { headers })).status, 401);
  });
});

// ---- entitlements --------------------------------------------------------------

describe("entitlements", () => {
  it("free by default", async () => {
    const headers = await login();
    const { status, data } = await call("GET", "/api/entitlements", { headers });
    assert.equal(status, 200);
    assert.deepEqual(data, {
      pro: false,
      tier: "free",
      granted_at: null,
      payment_id: null,
    });
  });

  it("401 without a session", async () => {
    assert.equal((await call("GET", "/api/entitlements")).status, 401);
  });

  it("401 with a malformed Authorization header", async () => {
    const { status } = await call("GET", "/api/entitlements", {
      headers: { Authorization: "Token abc" },
    });
    assert.equal(status, 401);
  });

  it("reverify restores Pro after the entitlement row is deleted", async () => {
    const headers = await login();
    assert.equal(
      (
        await call("POST", "/api/payments/approve", {
          body: { payment_id: "pay-1" },
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/payments/complete", {
          body: { payment_id: "pay-1", txid: "tx-1" },
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("GET", "/api/entitlements", { headers })).data.pro,
      true,
    );

    // Simulate a lost entitlement row (e.g. database rebuilt from scratch).
    db.exec("DELETE FROM entitlements WHERE uid = 'test-user-uid'");
    assert.equal(
      (await call("GET", "/api/entitlements", { headers })).data.pro,
      false,
    );

    const { status, data } = await call("POST", "/api/entitlements/reverify", {
      headers,
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { pro: true, restored: true });
    assert.equal(
      (await call("GET", "/api/entitlements", { headers })).data.pro,
      true,
    );
  });

  it("reverify reports restored=false when already Pro", async () => {
    const headers = await login();
    await call("POST", "/api/payments/approve", {
      body: { payment_id: "pay-1" },
      headers,
    });
    await call("POST", "/api/payments/complete", {
      body: { payment_id: "pay-1", txid: "tx-1" },
      headers,
    });
    const { data } = await call("POST", "/api/entitlements/reverify", {
      headers,
    });
    assert.deepEqual(data, { pro: true, restored: false });
  });
});

// ---- payments ------------------------------------------------------------------

describe("payments", () => {
  it("full flow: approve -> complete -> Pro, payment lookup fields", async () => {
    const headers = await login();

    const approved = await call("POST", "/api/payments/approve", {
      body: { payment_id: "pay-1" },
      headers,
    });
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.data, { ok: true });

    const completed = await call("POST", "/api/payments/complete", {
      body: { payment_id: "pay-1", txid: "tx-abc" },
      headers,
    });
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.data, { ok: true, pro: true });

    const ent = (await call("GET", "/api/entitlements", { headers })).data;
    assert.equal(ent.pro, true);
    assert.equal(ent.tier, "pro");
    assert.equal(ent.payment_id, "pay-1");
    assert.ok(ent.granted_at);

    const payment = (await call("GET", "/api/payments/pay-1", { headers })).data;
    assert.equal(payment.status, "completed");
    assert.equal(payment.txid, "tx-abc");
    assert.equal(payment.amount, 1.0);
    assert.equal(payment.memo, "Pro unlock — SwiftPDF for Pi");
  });

  it("complete without a prior approve returns 404", async () => {
    const headers = await login();
    const { status } = await call("POST", "/api/payments/complete", {
      body: { payment_id: "pay-never-approved", txid: "tx-1" },
      headers,
    });
    assert.equal(status, 404);
  });

  it("cancel marks the payment cancelled and does not grant Pro", async () => {
    const headers = await login();
    assert.equal(
      (
        await call("POST", "/api/payments/approve", {
          body: { payment_id: "pay-2" },
          headers,
        })
      ).status,
      200,
    );
    const { status, data } = await call("POST", "/api/payments/cancel", {
      body: { payment_id: "pay-2" },
      headers,
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true });
    const payment = (await call("GET", "/api/payments/pay-2", { headers })).data;
    assert.equal(payment.status, "cancelled");
    assert.equal(
      (await call("GET", "/api/entitlements", { headers })).data.pro,
      false,
    );
  });

  it("approve with a Platform failure returns 502 and records nothing", async () => {
    installPiStub({ failApprove: true });
    const headers = await login();
    const { status } = await call("POST", "/api/payments/approve", {
      body: { payment_id: "pay-3" },
      headers,
    });
    assert.equal(status, 502);
    assert.equal(
      (await call("GET", "/api/payments/pay-3", { headers })).status,
      404,
    );
  });

  it("payment lookup by another user or unknown id returns 404", async () => {
    const headers = await login();
    assert.equal(
      (
        await call("POST", "/api/payments/approve", {
          body: { payment_id: "pay-4" },
          headers,
        })
      ).status,
      200,
    );
    const otherHeaders = await login("other-token");
    assert.equal(
      (await call("GET", "/api/payments/pay-4", { headers: otherHeaders }))
        .status,
      404,
    );
    assert.equal(
      (await call("GET", "/api/payments/pay-unknown", { headers })).status,
      404,
    );
  });

  it("complete by another user returns 404", async () => {
    const headers = await login();
    await call("POST", "/api/payments/approve", {
      body: { payment_id: "pay-5" },
      headers,
    });
    const otherHeaders = await login("other-token");
    const { status } = await call("POST", "/api/payments/complete", {
      body: { payment_id: "pay-5", txid: "tx-1" },
      headers: otherHeaders,
    });
    assert.equal(status, 404);
  });
});

// ---- CORS ------------------------------------------------------------------------

describe("CORS", () => {
  it("allowed origin gets Access-Control-Allow-Origin + credentials", async () => {
    const { headers } = await call("GET", "/api/health", {
      headers: { Origin: "https://swiftpdf-for-pi.pages.dev" },
    });
    assert.equal(
      headers.get("Access-Control-Allow-Origin"),
      "https://swiftpdf-for-pi.pages.dev",
    );
    assert.equal(headers.get("Access-Control-Allow-Credentials"), "true");
  });

  it("disallowed origin gets no Access-Control-Allow-Origin", async () => {
    const { headers } = await call("GET", "/api/health", {
      headers: { Origin: "https://evil.example.com" },
    });
    assert.equal(headers.get("Access-Control-Allow-Origin"), null);
  });

  it("preflight on an allowed origin returns allow headers", async () => {
    const { status, headers } = await call("OPTIONS", "/api/entitlements", {
      headers: {
        Origin: "https://swiftpdf-for-pi.pages.dev",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    assert.equal(status, 200);
    assert.equal(
      headers.get("Access-Control-Allow-Origin"),
      "https://swiftpdf-for-pi.pages.dev",
    );
    assert.ok(headers.get("Access-Control-Allow-Methods"));
    assert.ok(headers.get("Access-Control-Allow-Headers"));
  });
});

// ---- mock mode ---------------------------------------------------------------------

describe("mock mode (PI_MOCK_MODE=true)", () => {
  beforeEach(() => {
    env = makeEnv({ PI_MOCK_MODE: "true" });
    // Prove no Pi HTTP happens: any fetch call throws.
    globalThis.fetch = async () => {
      throw new Error("mock mode must not call the Pi API");
    };
  });

  it("verifies any token as mockpioneer", async () => {
    const { status, data } = await call("POST", "/api/auth/verify", {
      body: { access_token: "anything" },
    });
    assert.equal(status, 200);
    assert.equal(data.user.username, "mockpioneer");
    assert.equal(data.user.uid, "mock-user-uid");
  });

  it("health reports mock_mode true", async () => {
    const { data } = await call("GET", "/api/health");
    assert.equal(data.mock_mode, true);
  });

  it("full mock payment flow grants Pro without any Pi HTTP", async () => {
    const headers = await login();
    assert.equal(
      (
        await call("POST", "/api/payments/approve", {
          body: { payment_id: "pay-mock" },
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/payments/complete", {
          body: { payment_id: "pay-mock", txid: "tx-mock" },
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("GET", "/api/entitlements", { headers })).data.pro,
      true,
    );
  });
});
