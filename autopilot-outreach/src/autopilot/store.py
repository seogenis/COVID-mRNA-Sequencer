"""SQLite-backed lead store. One row per lead; the full object lives in a JSON
blob with a few promoted columns for cheap querying/filtering in the dashboard.

Stdlib only. Safe to call from the CLI and the dashboard concurrently.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Optional

from .config import settings
from .models import Lead, Status


class LeadStore:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = Path(db_path or settings.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS leads (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    name TEXT,
                    category TEXT,
                    city TEXT,
                    presence_score INTEGER,
                    presence_category TEXT,
                    paid INTEGER DEFAULT 0,
                    updated_at TEXT DEFAULT (datetime('now')),
                    data TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_status ON leads(status)")

    # ---- writes ----------------------------------------------------------
    def upsert(self, lead: Lead) -> None:
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO leads
                    (id, status, name, category, city, presence_score,
                     presence_category, paid, updated_at, data)
                VALUES (?,?,?,?,?,?,?,?,datetime('now'),?)
                ON CONFLICT(id) DO UPDATE SET
                    status=excluded.status,
                    name=excluded.name,
                    category=excluded.category,
                    city=excluded.city,
                    presence_score=excluded.presence_score,
                    presence_category=excluded.presence_category,
                    paid=excluded.paid,
                    updated_at=datetime('now'),
                    data=excluded.data
                """,
                (
                    lead.id,
                    lead.status,
                    lead.business.name,
                    lead.business.category,
                    lead.business.city,
                    lead.presence.score,
                    lead.presence.category,
                    1 if lead.billing.paid else 0,
                    lead.to_json(),
                ),
            )

    def upsert_many(self, leads: Iterable[Lead]) -> None:
        for lead in leads:
            self.upsert(lead)

    # ---- reads -----------------------------------------------------------
    def get(self, lead_id: str) -> Optional[Lead]:
        with self._conn() as c:
            row = c.execute("SELECT data FROM leads WHERE id=?", (lead_id,)).fetchone()
        return Lead.from_json(row["data"]) if row else None

    def all(self) -> list[Lead]:
        with self._conn() as c:
            rows = c.execute("SELECT data FROM leads ORDER BY updated_at DESC").fetchall()
        return [Lead.from_json(r["data"]) for r in rows]

    def by_status(self, status: Status | str) -> list[Lead]:
        s = status.value if isinstance(status, Status) else status
        with self._conn() as c:
            rows = c.execute(
                "SELECT data FROM leads WHERE status=? ORDER BY updated_at DESC", (s,)
            ).fetchall()
        return [Lead.from_json(r["data"]) for r in rows]

    def counts(self) -> dict[str, int]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) n FROM leads GROUP BY status"
            ).fetchall()
        return {r["status"]: r["n"] for r in rows}

    def revenue(self) -> int:
        with self._conn() as c:
            rows = c.execute(
                "SELECT data FROM leads WHERE paid=1"
            ).fetchall()
        total = 0
        for r in rows:
            total += Lead.from_json(r["data"]).billing.quote
        return total
