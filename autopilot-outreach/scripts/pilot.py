#!/usr/bin/env python3
"""Pilot: run ONE real business through the pipeline by hand.

This is the bridge between mock and live — no API keys needed. You supply a
JSON file with the business's public info (from their Google listing / site),
and pilot will:

  1. audit their real website with the live HeadlessPresence provider
     (real HTTP fetch + the same heuristics live mode uses),
  2. build the real demo site from the copy in the JSON (hand-written or
     LLM-written — pilot doesn't care),
  3. store the lead so it shows up in `run.py show/list` and the dashboard,
  4. print the intro email (respecting APOP_PRICE — set APOP_PRICE=0 for the
     free-first offer) so you can review before any outreach happens.

Nothing is sent anywhere. Outreach stays human-approved for pilots.

Usage:
  python3 scripts/pilot.py path/to/business.json [--skip-audit]

JSON shape (see data/pilots/example at the bottom of this file):
  {
    "id": "pilot-001",
    "business": {"name": ..., "category": ..., "city": ..., "state": ...,
                 "phone": ..., "address": ..., "hours": ..., "rating": ...,
                 "review_count": ...},
    "website": "https://... (empty string if none)",
    "contacts": {"owner_name": ..., "emails": [...], "phones": [...]},
    "enrichment": {"services": [...], "review_summary": ..., "tagline": ...},
    "copy": { ... optional: headline/subhead/about/services/cta/review ... }
  }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autopilot.cadence import assign_variant, render_email  # noqa: E402
from autopilot.config import settings  # noqa: E402
from autopilot.models import (  # noqa: E402
    Business, Contacts, Enrichment, Lead, Status,
)
from autopilot.pipeline import qa_demo  # noqa: E402
from autopilot.providers.live import HeadlessPresence  # noqa: E402
from autopilot.providers.mock import MockContentWriter  # noqa: E402
from autopilot.sitegen import build_site  # noqa: E402
from autopilot.store import LeadStore  # noqa: E402


def load_lead(spec: dict) -> Lead:
    lead = Lead(
        id=spec["id"],
        source="pilot_manual",
        business=Business(**spec.get("business", {})),
        contacts=Contacts(**spec.get("contacts", {})),
        enrichment=Enrichment(**spec.get("enrichment", {})),
    )
    lead.presence.url = spec.get("website", "")
    lead.presence.has_site = bool(lead.presence.url)
    lead.note("pilot lead created from JSON spec")
    return lead


def main() -> None:
    ap = argparse.ArgumentParser(description="Run one real business through the pipeline")
    ap.add_argument("spec", help="path to the business JSON file")
    ap.add_argument("--skip-audit", action="store_true",
                    help="skip the live website fetch/audit")
    args = ap.parse_args()

    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    settings.ensure_dirs()
    store = LeadStore()
    lead = load_lead(spec)

    # 1. Real website audit (live provider, real HTTP).
    if args.skip_audit:
        lead.note("audit skipped (--skip-audit)")
    else:
        print(f"▶ Auditing {lead.presence.url or '(no website listed)'} ...")
        HeadlessPresence().analyze(lead)
        lead.note(f"presence={lead.presence.category} score={lead.presence.score}")
        print(f"  presence: {lead.presence.category} (score {lead.presence.score})")
        for issue in lead.presence.issues:
            print(f"    - {issue}")

    # 2. Build the demo from provided copy (or the rule-based writer).
    copy = spec.get("copy") or MockContentWriter().write_copy(lead)
    passed, notes = qa_demo(lead, copy)
    demo = build_site(lead, copy)
    demo.qa_passed = passed
    demo.qa_notes = notes
    lead.demo = demo
    # Variant rule for pilots: if we could not verify their existing site,
    # force variant A (curiosity hook) — it makes zero claims about their
    # current web presence, so it stays truthful with no audit evidence.
    inconclusive = any("INCONCLUSIVE" in i for i in lead.presence.issues)
    lead.cadence.variant = "A" if inconclusive else assign_variant(lead.id)
    if inconclusive:
        lead.note("audit inconclusive → forced variant A (no-claims hook)")
    lead.status = Status.DEMO_BUILT.value if passed else Status.QUALIFIED.value
    lead.note(f"pilot demo built (QA {'PASS' if passed else 'FAIL ' + str(notes)})")
    store.upsert(lead)

    print(f"\n✔ Demo built: {demo.path}")
    print(f"  QA: {'PASS' if passed else 'FAIL ' + str(notes)}")
    print(f"  Dashboard: python3 run.py dashboard → /lead/{lead.id}")

    # 3. Preview the intro email — review only; nothing is sent.
    subject, body = render_email(lead, "intro", lead.cadence.variant)
    print("\n--- Intro email preview (NOT sent — human approval required) ---")
    print(f"To: {lead.contacts.emails[0] if lead.contacts.emails else '(no email on file)'}")
    print(f"Subject: {subject}\n\n{body}")


if __name__ == "__main__":
    main()
