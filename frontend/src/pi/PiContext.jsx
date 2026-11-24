import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import { api, getSessionToken, setSessionToken } from "./api.js";
import { loadPiSdk, inPiBrowser, isSandbox, isMockMode } from "./piSdk.js";
import { limitsFor } from "./limits.js";

// Guest-first Pi state. Nobody is signed in until they press "Sign in
// with Pi" — the landing page and every free tool work without it.
// The backend is the authority on Pro status: the frontend never
// decides entitlements from the Pi user object alone.
const PiContext = createContext(null);

export function PiProvider({ children }) {
  const [user, setUser] = useState(null); // { uid, username } from the backend
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true); // session restore on load
  const [busy, setBusy] = useState(false); // sign-in / payment in flight
  const [error, setError] = useState("");
  const [proConfig, setProConfig] = useState(null); // { pro_price_pi, pro_memo, network }

  const refreshEntitlements = useCallback(async () => {
    try {
      const ent = await api.entitlements();
      setIsPro(Boolean(ent.pro));
      return ent;
    } catch (err) {
      if (err.status === 401) {
        setSessionToken("");
        setUser(null);
        setIsPro(false);
      }
      throw err;
    }
  }, []);

  // Restore a saved session on load (and fetch the public Pro config).
  // This never calls Pi.authenticate — it only talks to our backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.config().catch(() => null);
        if (!cancelled && cfg) setProConfig(cfg);
      } catch { /* config is best-effort; the Pro page retries */ }
      if (getSessionToken()) {
        try {
          await refreshEntitlements();
          // Username is not returned by /entitlements; keep the stored
          // one from sign-in (localStorage) for display only.
          const stored = JSON.parse(localStorage.getItem("pi-pdf-user") || "null");
          if (!cancelled && stored) setUser(stored);
        } catch { /* session invalid — already cleared */ }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshEntitlements]);

  // Pi calls this when the user has a payment that reached the
  // blockchain but was never developer-completed. Without a txid we
  // cannot complete it, so we cancel it server-side (best effort) and
  // let the user start a fresh payment.
  const handleIncompletePayment = useCallback(async (payment) => {
    try {
      if (payment?.identifier) await api.cancelPayment(payment.identifier);
    } catch { /* stale payment stays stale; sign-in continues */ }
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      if (!inPiBrowser() && !isMockMode()) {
        throw new Error("Sign in with Pi works inside Pi Browser. Open this app from Pi Browser on your phone, then try again.");
      }
      const Pi = await loadPiSdk();
      const auth = await Pi.authenticate(["username", "payments", "wallet_address"], handleIncompletePayment);
      if (!auth?.accessToken) throw new Error("Pi sign-in did not return an access token.");
      // The backend verifies the token with Pi's /v2/me endpoint and
      // issues our own session — the frontend user object is display
      // only and is never trusted for entitlements.
      const result = await api.verifyAuth(auth.accessToken);
      setSessionToken(result.session_token);
      setUser(result.user);
      try { localStorage.setItem("pi-pdf-user", JSON.stringify(result.user)); } catch { /* ignore */ }
      setIsPro(Boolean(result.pro));
      return result.user;
    } catch (err) {
      const msg = err?.message || "Sign-in failed. Please try again.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  }, [handleIncompletePayment]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* session already gone */ }
    setSessionToken("");
    try { localStorage.removeItem("pi-pdf-user"); } catch { /* ignore */ }
    setUser(null);
    setIsPro(false);
  }, []);

  // One-time Pro unlock via a Pi U2A payment. Subscriptions are
  // Testnet-only on Pi, so Pro is a single lifetime payment, never a
  // recurring charge.
  const buyPro = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      let currentUser = user;
      if (!currentUser) currentUser = await signIn();
      const cfg = proConfig || (await api.config());
      const amount = Number(cfg.pro_price_pi);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Pro pricing is not configured yet.");
      const Pi = await loadPiSdk();
      await new Promise((resolve, reject) => {
        Pi.createPayment(
          { amount, memo: cfg.pro_memo || "Pro unlock", metadata: { type: "pro_unlock" } },
          {
            onReadyForServerApproval: async (paymentId) => {
              try {
                await api.approvePayment(paymentId);
              } catch (err) {
                reject(new Error(`Payment approval failed: ${err.message}`));
              }
            },
            onReadyForServerCompletion: async (paymentId, txid) => {
              try {
                await api.completePayment(paymentId, txid);
                await refreshEntitlements();
                resolve();
              } catch (err) {
                reject(new Error(`Payment completion failed: ${err.message}`));
              }
            },
            onCancel: () => reject(new Error("Payment cancelled.")),
            onError: (err) => reject(new Error(err?.message || "Payment failed.")),
          },
        );
      });
    } catch (err) {
      const msg = err?.message || "Unlocking Pro failed. Please try again.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  }, [user, proConfig, signIn, refreshEntitlements]);

  const value = useMemo(() => ({
    user,
    isPro,
    limits: limitsFor(isPro),
    loading,
    busy,
    error,
    setError,
    proConfig,
    sandbox: isSandbox(),
    mockMode: isMockMode(),
    signIn,
    signOut,
    buyPro,
    refreshEntitlements,
  }), [user, isPro, loading, busy, error, proConfig, signIn, signOut, buyPro, refreshEntitlements]);

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

export function usePi() {
  const ctx = useContext(PiContext);
  if (!ctx) throw new Error("usePi must be used inside <PiProvider>.");
  return ctx;
}
