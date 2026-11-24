import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { APP_NAME } from "../config/site.js";
import { usePi } from "../pi/PiContext.jsx";

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("pi-pdf-theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode">
      {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}

export default function Header() {
  const { user, isPro, busy, signIn, signOut, error, setError } = usePi();
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();

  const onSignIn = async () => {
    setError("");
    try {
      await signIn();
    } catch {
      // Error text is already in context state; shown below the header.
    }
  };

  return (
    <header className="site-header">
      <div className="container">
        <Link className="brand" to="/" onClick={() => setNavOpen(false)}>
          <img src="/favicon.svg" alt="" width="26" height="26" style={{ verticalAlign: "-5px", marginRight: 8 }} />
          {APP_NAME}
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((v) => !v)}
        >
          Menu
        </button>
        <ThemeToggle />
        {user ? (
          <span style={{ color: "#d7e3de", fontSize: ".92rem", whiteSpace: "nowrap" }}>
            @{user.username}
            {isPro && <span className="category-badge" style={{ marginLeft: 8, marginBottom: 0 }}>Pro</span>}
            {" "}
            <button type="button" className="btn btn-sm ghost" style={{ color: "#fff", borderColor: "rgba(255,255,255,.35)" }} disabled={busy} onClick={signOut}>
              Sign out
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onSignIn}>
            {busy ? "Signing in…" : "Sign in with Pi"}
          </button>
        )}
        <nav className={`nav${navOpen ? " open" : ""}`} aria-label="Main">
          <NavLink to="/" end onClick={() => setNavOpen(false)}>All tools</NavLink>
          <NavLink to="/tools/merge-pdf" onClick={() => setNavOpen(false)}>Merge PDF</NavLink>
          <NavLink to="/tools/split-pdf" onClick={() => setNavOpen(false)}>Split PDF</NavLink>
          <NavLink to="/tools/compress-pdf" onClick={() => setNavOpen(false)}>Compress PDF</NavLink>
          <NavLink to="/tools/ocr-pdf" onClick={() => setNavOpen(false)}>OCR</NavLink>
          <NavLink to="/pro" onClick={() => setNavOpen(false)}>Pro ⭐</NavLink>
          <NavLink to="/privacy" onClick={() => setNavOpen(false)}>Privacy</NavLink>
        </nav>
      </div>
      {error && (
        <div className="container">
          <p className="error" role="alert" style={{ marginTop: 8 }}>
            {error}{" "}
            <button type="button" className="btn btn-sm ghost" onClick={() => { setError(""); navigate("/pro"); }}>
              See Pro options
            </button>
          </p>
        </div>
      )}
    </header>
  );
}
