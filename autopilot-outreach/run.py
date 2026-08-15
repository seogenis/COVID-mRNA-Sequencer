#!/usr/bin/env python3
"""Autopilot Outreach — single CLI entrypoint.

Everything you need to test/debug the system, no dependencies, no keys:

  python run.py demo                 # full mock campaign, all cadence days simulated
  python run.py demo --city Phoenix --category auto_repair --limit 15
  python run.py dashboard            # serve the local dashboard (localhost:8000)
  python run.py tick --day 3         # execute cadence touches due on campaign day 3
  python run.py stats                # A/B variant performance table
  python run.py doctor               # environment check: what's configured, what's not
  python run.py show <lead_id>       # print one lead's full audit trail
  python run.py list                 # list all leads + statuses
  python run.py summary              # funnel counts + revenue
  python run.py reset                # wipe the local db + generated artifacts

Flags:
  --seed N      change the deterministic dataset
  --mode live   use real providers (run `doctor` to see which are configured)
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
    if getattr(args, "free", False):
        settings.price_one_time = 0
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
    print(f"\nTouches sent:   {summary.get('touches', 0)} "
          f"(simulated days {summary.get('days_simulated', [])})")
    print(f"Revenue (mock): ${summary['revenue']:,}")
    _print_ab(store)
    print(f"\nDemo sites:     {settings.demos_dir}")
    print(f"Outbox:         {settings.outbox_dir}")
    print(f"\nNext: python run.py dashboard   → open http://localhost:8000")


def _print_ab(store) -> None:
    from autopilot.cadence import ab_stats
    stats = ab_stats(store.all())
    if not stats:
        return
    print("\nA/B script performance:")
    print(f"  {'variant':<9}{'leads':<7}{'emails':<8}{'calls':<7}"
          f"{'interested':<12}{'converted':<11}revenue")
    for v, s in sorted(stats.items()):
        print(f"  {v:<9}{s['leads']:<7}{s['emails']:<8}{s['calls']:<7}"
              f"{s['interested']:<12}{s['converted']:<11}${s['revenue']:,}")


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


def cmd_find(args) -> None:
    """Live discovery + qualification only: find no-site targets worth pitching.

    Filters: no website listed on Google, rating >= --min-rating, at least
    --min-reviews reviews (active + established), and a phone number.
    Qualified targets are stored as NEW leads; nothing is contacted.
    """
    _apply_common(args)
    from autopilot.providers.live import GooglePlacesDiscovery

    gp = GooglePlacesDiscovery()
    store = LeadStore()
    pool, seen = [], set()
    for city in args.city:
        try:
            for lead in gp.search(city, args.category, args.limit):
                if lead.id not in seen:
                    seen.add(lead.id)
                    pool.append(lead)
        except Exception as e:
            print(f"[{city}] {type(e).__name__}: {e}")

    targets = [l for l in pool
               if not l.presence.url
               and l.business.rating >= args.min_rating
               and l.business.review_count >= args.min_reviews
               and l.business.phone]
    targets.sort(key=lambda l: (-l.business.rating, -l.business.review_count))
    for lead in targets:
        lead.note(f"qualified no-site target (rating {lead.business.rating}, "
                  f"{lead.business.review_count} reviews)")
        store.upsert(lead)

    print(f"pool: {len(pool)} · qualified no-site targets: {len(targets)} (stored)\n")
    for l in targets:
        print(f"  {l.business.rating}★ ({l.business.review_count:>3})  "
              f"{l.business.name} | {l.business.phone} | {l.business.address}")


def cmd_tick(args) -> None:
    _apply_common(args)
    pipe = Pipeline(LeadStore())
    touched = pipe.tick(args.day)
    print(f"Day {args.day}: executed {touched} touch(es).")
    s = pipe.summary()
    print(f"Funnel: {s['counts']}  ·  Revenue: ${s['revenue']:,}")


def cmd_stats(args) -> None:
    _apply_common(args)
    _print_ab(LeadStore())


def cmd_doctor(args) -> None:
    """Environment check: what's configured, what each missing key unlocks."""
    _apply_common(args)
    import glob as _glob
    import platform

    def row(ok, label, detail=""):
        mark = "✓" if ok else "✗"
        print(f"  {mark} {label:<34} {detail}")

    print(f"Autopilot doctor — mode={settings.mode}, seed={settings.seed}\n")

    print("Runtime:")
    row(sys.version_info >= (3, 9), "Python ≥ 3.9", platform.python_version())
    try:
        settings.ensure_dirs()
        probe = settings.data_dir / ".probe"
        probe.write_text("ok")
        probe.unlink()
        row(True, "Data dir writable", str(settings.data_dir))
    except Exception as e:
        row(False, "Data dir writable", str(e))
    n = len(LeadStore().all())
    row(True, "Lead store", f"{n} lead(s) in {settings.db_path.name}")
    chromium = (_glob.glob("/opt/pw-browsers/*/chrome-linux/headless_shell")
                or _glob.glob("/opt/pw-browsers/*/chrome-linux/chrome"))
    row(bool(chromium), "Chromium (screenshots, optional)",
        chromium[0] if chromium else "not found — heuristic audit still works")

    print("\nLive providers (needed only for --mode live):")
    checks = [
        (settings.google_places_key, "GOOGLE_PLACES_API_KEY", "discovery (Google Places)"),
        (settings.anthropic_key, "ANTHROPIC_API_KEY", "LLM site copy"),
        (settings.smtp_host, "APOP_SMTP_HOST", "outbound email"),
        (settings.from_email, "APOP_FROM_EMAIL", "outbound email sender"),
        (settings.postal_address, "APOP_POSTAL_ADDRESS", "CAN-SPAM footer (required)"),
        (settings.stripe_key, "STRIPE_API_KEY", "payments (Stripe Checkout)"),
        (settings.vapi_key, "VAPI_API_KEY", "AI voice calls"),
    ]
    for val, env, unlocks in checks:
        row(bool(val), env, f"→ {unlocks}")
    row(settings.voice_enabled, "APOP_VOICE_ENABLED=1",
        "→ voice hard-gate (read docs/DESIGN.md §7 first)")
    print("\nAlways available: mock mode (no keys), presence heuristics, sitegen,")
    print("dashboard, cadence engine. Enrichment (live) needs a broker choice.")


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
    d.add_argument("--free", action="store_true",
                   help="free-first campaign: all copy offers the site for free")
    d.set_defaults(func=cmd_demo)

    db = sub.add_parser("dashboard", help="serve the local dashboard")
    db.add_argument("--port", type=int, default=8000)
    db.set_defaults(func=cmd_dashboard)

    s = sub.add_parser("show", help="print one lead's full trail")
    s.add_argument("lead_id")
    s.set_defaults(func=cmd_show)

    f = sub.add_parser("find", help="live discovery: qualified no-site targets")
    f.add_argument("--city", action="append", required=True,
                   help="repeatable, e.g. --city 'Waco, TX' --city 'Temple, TX'")
    f.add_argument("--category", default="landscaping")
    f.add_argument("--limit", type=int, default=20, help="per city")
    f.add_argument("--min-rating", type=float, default=4.0)
    f.add_argument("--min-reviews", type=int, default=3)
    f.set_defaults(func=cmd_find)

    t = sub.add_parser("tick", help="execute cadence touches due on a campaign day")
    t.add_argument("--day", type=int, required=True)
    t.set_defaults(func=cmd_tick)

    sub.add_parser("stats", help="A/B variant performance").set_defaults(func=cmd_stats)
    sub.add_parser("doctor", help="environment / configuration check").set_defaults(func=cmd_doctor)
    sub.add_parser("list", help="list all leads").set_defaults(func=cmd_list)
    sub.add_parser("summary", help="funnel + revenue").set_defaults(func=cmd_summary)
    sub.add_parser("reset", help="wipe local data").set_defaults(func=cmd_reset)
    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
