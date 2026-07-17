"""Central configuration. Everything is env-driven with mock-friendly defaults.

The single most important switch is APOP_MODE:
  - "mock"  (default): every external service is faked; runs offline, no keys.
  - "live":            real providers are used where a key is present, else
                       the stage fails loudly with a clear message.

Design goal: you can run the entire pipeline end-to-end with ZERO setup.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Repo-root/data — all generated artifacts live here so `make clean` is trivial.
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("APOP_DATA_DIR", ROOT / "data"))


def _flag(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    mode: str = os.environ.get("APOP_MODE", "mock")

    # Deterministic seed so mock runs are reproducible — critical for debugging.
    seed: int = int(os.environ.get("APOP_SEED", "42"))

    # Where generated demo sites and the outbox (sent emails / call transcripts) go.
    data_dir: Path = DATA_DIR
    db_path: Path = field(default_factory=lambda: DATA_DIR / "leads.db")
    demos_dir: Path = field(default_factory=lambda: DATA_DIR / "demos")
    outbox_dir: Path = field(default_factory=lambda: DATA_DIR / "outbox")

    # Qualification thresholds. Only "no_site" / "outdated" leads are targets.
    max_presence_score: int = int(os.environ.get("APOP_MAX_PRESENCE_SCORE", "55"))

    # Preview host used to build demo URLs (mock uses local dashboard links).
    preview_host: str = os.environ.get("APOP_PREVIEW_HOST", "http://localhost:8000")

    # Commercial defaults.
    price_one_time: int = int(os.environ.get("APOP_PRICE", "1000"))
    price_monthly: int = int(os.environ.get("APOP_PRICE_MONTHLY", "35"))

    # Compliance: allowed local calling window (24h clock).
    call_hours_start: int = int(os.environ.get("APOP_CALL_START", "8"))
    call_hours_end: int = int(os.environ.get("APOP_CALL_END", "21"))

    # Real-provider API keys (only read in live mode).
    google_places_key: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
    openai_key: str = os.environ.get("OPENAI_API_KEY", "")
    anthropic_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    twilio_sid: str = os.environ.get("TWILIO_ACCOUNT_SID", "")
    stripe_key: str = os.environ.get("STRIPE_API_KEY", "")

    @property
    def is_mock(self) -> bool:
        return self.mode.strip().lower() == "mock"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.demos_dir, self.outbox_dir):
            d.mkdir(parents=True, exist_ok=True)


# Module-level singleton; import `settings` everywhere.
settings = Settings()
