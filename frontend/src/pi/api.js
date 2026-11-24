// Backend API client. Base URL comes from VITE_API_URL; empty means
// same-origin (Vite proxies /api to the FastAPI backend in dev; in
// production the built site calls the deployed backend URL).
// The session token is the ONLY credential the frontend holds — the Pi
// Server API Key lives on the backend and never appears here.
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const SESSION_KEY = "pi-pdf-session";

export function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode — session just won't persist across reloads.
  }
}

async function request(path, { method = "GET", body = null, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getSessionToken();
    if (!token) throw Object.assign(new Error("Not signed in."), { status: 401 });
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/api/health"),
  config: () => request("/api/config"),
  verifyAuth: (accessToken) => request("/api/auth/verify", { method: "POST", body: { access_token: accessToken } }),
  logout: () => request("/api/auth/logout", { method: "POST", auth: true }),
  entitlements: () => request("/api/entitlements", { auth: true }),
  reverifyEntitlements: () => request("/api/entitlements/reverify", { method: "POST", auth: true }),
  approvePayment: (paymentId) => request("/api/payments/approve", { method: "POST", auth: true, body: { payment_id: paymentId } }),
  completePayment: (paymentId, txid) =>
    request("/api/payments/complete", { method: "POST", auth: true, body: { payment_id: paymentId, txid } }),
  cancelPayment: (paymentId) => request("/api/payments/cancel", { method: "POST", auth: true, body: { payment_id: paymentId } }),
};
