import { useEffect, useState } from "react";
import { APP_NAME, PRO_FEATURES } from "../config/site.js";
import { usePi } from "../pi/PiContext.jsx";
import { api } from "../pi/api.js";
import { FREE_LIMITS, PRO_LIMITS, formatLimit } from "../pi/limits.js";
import { formatBytes } from "../tools/pdf/pdfSmall.js";

export default function ProPage() {
  const { user, isPro, busy, signIn, buyPro, refreshEntitlements, proConfig, sandbox, mockMode, error, setError } = usePi();
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    document.title = `Pro — ${APP_NAME}`;
  }, []);

  const price = proConfig ? Number(proConfig.pro_price_pi) : null;

  const unlock = async () => {
    setError("");
    setMessage("");
    try {
      await buyPro();
      setMessage("Pro unlocked — thank you! All caps are lifted on this Pi account.");
    } catch {
      // Error text lives in context state and shows in the header.
    }
  };

  const restore = async () => {
    setRestoring(true);
    setError("");
    setMessage("");
    try {
      const result = await api.reverifyEntitlements();
      await refreshEntitlements();
      setMessage(
        result.restored
          ? "Found it — your Pro unlock has been restored from your Pi payment record."
          : result.pro
            ? "Your Pro unlock is already active on this account."
            : "No completed Pro payment was found for this Pi account.",
      );
    } catch (err) {
      setError(err.message || "Restore check failed. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="container section">
      <p className="kicker">Pro</p>
      <h1>Unlock everything, once</h1>
      <p className="lede">
        Pro is a single one-time payment in Pi — never a subscription. It is tied to your Pi account, so it
        follows you to any device where you sign in with Pi.
      </p>

      {sandbox && (
        <p className="notice info">
          Test mode: this build talks to the Pi Testnet, so payments use Test-Pi (no real value). The
          Mainnet build will charge real Pi — the price below stays the same.
          {mockMode && " Developer mock mode is on: sign-in and payments are simulated locally."}
        </p>
      )}

      <table className="table">
        <thead>
          <tr><th>Limit</th><th>Free</th><th>Pro</th></tr>
        </thead>
        <tbody>
          <tr><td>Max file size</td><td>{formatBytes(FREE_LIMITS.maxFileBytes)}</td><td>{formatBytes(PRO_LIMITS.maxFileBytes)}</td></tr>
          <tr><td>Merge at once</td><td>{FREE_LIMITS.maxMergeFiles} PDFs</td><td>{PRO_LIMITS.maxMergeFiles} PDFs</td></tr>
          <tr><td>Images to PDF</td><td>{FREE_LIMITS.maxImages} images</td><td>{PRO_LIMITS.maxImages} images</td></tr>
          <tr><td>OCR pages</td><td>First {FREE_LIMITS.ocrPages}</td><td>First {PRO_LIMITS.ocrPages}</td></tr>
          <tr><td>PDF to images / text / Word</td><td>First {FREE_LIMITS.convertPages} pages</td><td>{formatLimit(PRO_LIMITS.convertPages)}</td></tr>
          <tr><td>Single-file tools</td><td>Up to {FREE_LIMITS.maxPages} pages</td><td>{formatLimit(PRO_LIMITS.maxPages)}</td></tr>
          <tr><td>Saved signature</td><td>No</td><td>Yes</td></tr>
        </tbody>
      </table>

      <h2>What you get</h2>
      <ul className="result-list">
        {PRO_FEATURES.map((f) => (
          <li key={f}><span>✓ {f}</span></li>
        ))}
      </ul>

      {isPro ? (
        <div className="output">
          <p className="success">You already have Pro{user ? ` on @${user.username}` : ""}. All caps are lifted.</p>
          <p style={{ fontSize: ".95rem" }}>
            If Pro ever looks missing on a new device, use the restore check — it re-verifies your payment with Pi.
          </p>
          <div className="toolbar">
            <button type="button" className="btn secondary" disabled={restoring} onClick={restore}>
              {restoring ? "Checking…" : "Restore Pro from my Pi payment"}
            </button>
          </div>
        </div>
      ) : (
        <div className="output">
          <p>
            <strong>Price: {price !== null && Number.isFinite(price) ? `${price} π (Pi)` : "loading…"}</strong>
            {" "}— one payment, lifetime Pro. No subscription, no renewal, no card.
          </p>
          {!user && <p style={{ fontSize: ".95rem" }}>You will be asked to sign in with Pi first — the unlock is stored against your Pi account.</p>}
          <div className="toolbar">
            <button type="button" className="btn" disabled={busy || price === null} onClick={unlock}>
              {busy ? "Working…" : user ? `Unlock Pro — ${price} π` : "Sign in with Pi & unlock Pro"}
            </button>
            {user && (
              <button type="button" className="btn ghost" disabled={restoring} onClick={restore}>
                {restoring ? "Checking…" : "I already paid — restore Pro"}
              </button>
            )}
          </div>
          <p style={{ fontSize: ".9rem", opacity: 0.85 }}>
            Payment runs through Pi Wallet: you approve it in the wallet, the payment is recorded on the Pi
            blockchain, and our server confirms it before unlocking Pro. Blockchain payments are final — if
            something goes wrong, use the restore check above.
          </p>
        </div>
      )}

      {message && <p className="success" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
