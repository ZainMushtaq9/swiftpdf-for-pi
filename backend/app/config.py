"""Configuration for the SwiftPDF for Pi backend (Pi Next 2026).

All settings come from environment variables, with a .env file (next to this
package's parent, i.e. backend/.env) loaded if present. No secrets are ever
hard-coded; placeholder defaults are inert (they will simply fail against the
real Pi Platform API until real values are supplied).
"""

from __future__ import annotations

import os
from pathlib import Path

# backend/ directory (parent of the app package).
BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env parser: KEY=VALUE lines, ignores blanks and # comments.

    Existing environment variables win over .env values. No quoting logic
    beyond stripping a single pair of matching quotes.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    """Runtime settings, read once at import from env / .env."""

    PI_API_KEY: str = _env("PI_API_KEY", "CHANGE_ME")
    PI_APP_ID: str = _env("PI_APP_ID", "CHANGE_ME")
    PI_NETWORK: str = _env("PI_NETWORK", "staging")  # "staging" | "production"
    PI_PLATFORM_API_BASE: str = _env(
        "PI_PLATFORM_API_BASE", "https://api.minepi.com/v2"
    )
    DATABASE_PATH: str = _env("DATABASE_PATH", "data/app.db")
    PRO_PRICE_PI: float = _env_float("PRO_PRICE_PI", 1.0)
    PRO_MEMO: str = _env("PRO_MEMO", "Pro unlock — SwiftPDF for Pi")
    SESSION_DAYS: int = _env_int("SESSION_DAYS", 30)
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in _env(
            "CORS_ORIGINS", "http://localhost:5173,http://localhost:4173"
        ).split(",")
        if origin.strip()
    ]
    # WARNING: mock mode returns canned Pi Platform responses and must NEVER
    # be enabled in production — it would grant Pro without real payment.
    PI_MOCK_MODE: bool = _env_bool("PI_MOCK_MODE", False)

    def database_path(self) -> Path:
        """Absolute path to the SQLite file (relative paths resolve under backend/)."""
        p = Path(self.DATABASE_PATH)
        return p if p.is_absolute() else BACKEND_DIR / p


settings = Settings()
