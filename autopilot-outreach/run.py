#!/usr/bin/env python3
"""Autopilot Outreach — single CLI entrypoint.

Everything you need to test/debug the system, no dependencies, no keys:

  python run.py demo                 # run a full mock campaign end-to-end
  python run.py demo --city Phoenix --category auto_repair --limit 15
  python run.py dashboard            # serve the local dashboard (localhost:8000)
  python run.py show <lead_id>       # print one lead's full audit trail
  python run.py list                 # list all leads + statuses
  python run.py summary              # funnel counts + revenue
  python run.py reset                # wipe the local db + generated artifacts

Flags:
  --seed N      change the deterministic dataset
  --mode live   use real providers (requires keys; stubs raise until wired)
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

# Make `src/` importable without installation.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from autopilot.config import settings  # noqa: E402
from autopilot.pipeline import Pipeline  # noqa: E402
from autopilot.store import LeadStore  # noqa: E402


def _apply_common(args) -> None:
    if getattr(args, "seed", None) is not None:
        settings.seed = args.seed
    if getattr(args, "mode", None):
        settings.mode = args.mode
    settings.ensure_dirs()


def cmd_demo(args) -> None:
    _apply_common(args)
    store = LeadStore()
    pipe = Pipeline(store)
    print(f"▶ Running campaign: {args.category} in {args.city} "
          f"(limit={args.limit}, mode={settings.mode}, seed={settings.seed})\n")
    summary = pipe.run_campaign(args.city, args.category, args.limit)

    counts = summary["counts"]
    print("Funnel:")
    for status in ["NEW", "QUALIFIED", "REJECTED", "DEMO_BUILT", "CONTACTED",
                   "INTERESTED", "CONVERTED", "DEAD"]:
        if counts.get(status):
            print(f"  {status:<12} {counts[status]}")
    print(f"\nRevenue (mock): ${summary['revenue']:,}")
    print(f"Demo sites:     {settings.demos_dir}")
    print(f"Outbox:         {settings.outbox_dir}")
    print(f"\nNext: python run.py dashboard   → open http://localhost:8000")


def cmd_dashboard(args) -> None:
    _apply_common(args)
    from autopilot.dashboard import serve
    serve(port=args.port)


def cmd_show(args) -> None:
    _apply_common(args)
    lead = LeadStore().get(args.lead_id)
    if not lead:
        print(f"Lead {args.lead_id} not found.")
        return
    b = lead.business
    print(f"=== {b.name} [{lead.status}] ===")
    print(f"{b.address}, {b.city}, {b.state} · {b.phone}")
    print(f"Owner: {lead.contacts.owner_name} · {b.rating}★ ({b.review_count})")
    print(f"Presence: {lead.presence.category} (score {lead.presence.score})")
    print(f"  issues: {', '.join(lead.presence.issues) or 'none'}")
    if lead.demo.path:
        print(f"Demo: {lead.demo.path}")
        print(f"      QA {'PASS' if lead.demo.qa_passed else 'FAIL ' + str(lead.demo.qa_notes)}")
    print("\nAudit log:")
    for line in lead.log:
        print(f"  · {line}")
    if lead.outreach:
        print("\nOutreach:")
        for a in lead.outreach:
            print(f"  {a.channel}: {a.disposition} → {a.artifact}")


def cmd_list(args) -> None:
    _apply_common(args)
    leads = LeadStore().all()
    if not leads:
        print("No leads yet. Run: python run.py demo")
        return
    for ld in leads:
        print(f"{ld.id:<16} {ld.status:<12} {ld.presence.category:<9} "
              f"score={ld.presence.score:<3} {ld.business.name}")


def cmd_summary(args) -> None:
    _apply_common(args)
    store = LeadStore()
    counts = store.counts()
    print("Funnel counts:")
    for k, v in sorted(counts.items()):
        print(f"  {k:<12} {v}")
    print(f"Revenue (mock): ${store.revenue():,}")


def cmd_reset(args) -> None:
    _apply_common(args)
    if settings.data_dir.exists():
        shutil.rmtree(settings.data_dir)
    print(f"Wiped {settings.data_dir}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="autopilot", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seed", type=int, help="deterministic dataset seed")
    p.add_argument("--mode", choices=["mock", "live"], help="provider mode")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="run a full mock campaign")
    d.add_argument("--city", default="Austin")
    d.add_argument("--category", default="landscaping",
                   choices=["landscaping", "auto_repair", "plumbing"])
    d.add_argument("--limit", type=int, default=12)
    d.set_defaults(func=cmd_demo)

    db = sub.add_parser("dashboard", help="serve the local dashboard")
    db.add_argument("--port", type=int, default=8000)
    db.set_defaults(func=cmd_dashboard)

    s = sub.add_parser("show", help="print one lead's full trail")
    s.add_argument("lead_id")
    s.set_defaults(func=cmd_show)

    sub.add_parser("list", help="list all leads").set_defaults(func=cmd_list)
    sub.add_parser("summary", help="funnel + revenue").set_defaults(func=cmd_summary)
    sub.add_parser("reset", help="wipe local data").set_defaults(func=cmd_reset)
    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
