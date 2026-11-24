import { useEffect } from "react";
import { Link } from "react-router-dom";
import { APP_NAME, APP_TAGLINE, TOOLS, PRO_FEATURES } from "../config/site.js";
import { usePi } from "../pi/PiContext.jsx";

// Guest-first landing page: everything here works without signing in.
// Pi.authenticate is never called on load (PiNet rule) — sign-in is
// offered, never required, until a Pro feature is used.
export default function Home() {
  const { user, isPro } = usePi();

  useEffect(() => {
    document.title = `${APP_NAME} — ${APP_TAGLINE}`;
  }, []);

  return (
    <div>
      <section className="hero">
        <div className="container">
          <p className="hero-badge">🔒 100% in your browser — nothing is uploaded</p>
          <h1>Every PDF tool you need, <span className="accent">right on your phone.</span></h1>
          <p>{APP_TAGLINE} Merge, split, compress, rotate, sign and convert PDFs — free, with no account needed. Sign in with Pi to unlock Pro.</p>
          <div className="hero-stats">
            <div><b>13 tools</b><span>merge to OCR</span></div>
            <div><b>0 uploads</b><span>files stay on your device</span></div>
            <div><b>1 Pi payment</b><span>Pro unlocks everything, once</span></div>
          </div>
        </div>
      </section>

      <section className="section container">
        <p className="kicker">All tools</p>
        <h2>Pick a tool and start — no sign-in needed</h2>
        <p className="lede">Every tool below runs locally in your browser with pdf-lib, PDF.js and Tesseract. Your files never leave your device.</p>
        <div className="grid">
          {TOOLS.map((tool) => (
            <Link key={tool.slug} to={`/tools/${tool.slug}`} className="card tool-card" style={{ textDecoration: "none" }}>
              <span className="category-badge">PDF</span>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <p className="kicker">Pro</p>
        <h2>{isPro ? "You have Pro — enjoy the full toolkit." : "Go Pro with one Pi payment"}</h2>
        <p className="lede">
          {isPro
            ? "Your Pro unlock is tied to your Pi account, so it follows you to any device where you sign in with Pi."
            : "The free tier covers everyday jobs. Pro removes the caps — one payment in Pi, no subscription, yours for good."}
        </p>
        <ul className="result-list">
          {PRO_FEATURES.map((f) => (
            <li key={f}><span>✓ {f}</span></li>
          ))}
        </ul>
        {!isPro && (
          <div className="toolbar">
            <Link className="btn" to="/pro">See Pro &amp; unlock</Link>
            {user && <span style={{ alignSelf: "center" }}>Signed in as @{user.username}</span>}
          </div>
        )}
      </section>

      <section className="section container faq" style={{ paddingTop: 0 }}>
        <p className="kicker">Good to know</p>
        <h2>Questions, answered honestly</h2>
        <details>
          <summary>Do I need a Pi account to use the tools?</summary>
          <p>No. All 13 tools work for guests, free, with caps (for example 3 files per merge and OCR on the first 2 pages). A Pi account is only needed to buy Pro — and sign-in uses Pi itself, never an email or password.</p>
        </details>
        <details>
          <summary>Are my files uploaded anywhere?</summary>
          <p>No. Merging, splitting, compressing, rotating, watermarking, numbering, signing and converting all run in your browser. The OCR engine downloads from a public CDN on first use (about 10 MB), but your file itself is never sent anywhere. See the <Link to="/privacy">privacy policy</Link>.</p>
        </details>
        <details>
          <summary>What does Pro cost, and is it a subscription?</summary>
          <p>Pro is a single one-time payment in Pi — never a subscription. The price is shown on the <Link to="/pro">Pro page</Link>. Pi subscriptions are still Testnet-only, so this app does not use them at all.</p>
        </details>
        <details>
          <summary>What if I get a new phone?</summary>
          <p>Your Pro unlock is stored against your Pi account on our server, not on your phone. Sign in with Pi on the new device and Pro is there. If it ever looks missing, the Pro page has a restore check that re-verifies your payment with Pi.</p>
        </details>
      </section>
    </div>
  );
}
