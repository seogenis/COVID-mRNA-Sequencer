#!/usr/bin/env python3
"""Batch-build demo sites for every qualified no-site lead in the store.

For each stored lead in status NEW (i.e. discovered by `run.py find` and never
touched), this:
  1. writes grounded copy from VERIFIED Places data only (name, city, rating,
     review count) plus services conservatively inferred from the business
     name and category — every generated page carries only claims we can
     defend, and the call sheet flags services as "verify before sending",
  2. builds the demo site (same renderer as pilots),
  3. advances the lead to DEMO_BUILT and assigns its A/B variant,
  4. emits a ranked CALL SHEET (csv) + templated outreach copy.

Nothing is contacted. Outreach stays human-approved.

Usage:
  python3 scripts/batch_build.py            # build all NEW leads
  python3 scripts/batch_build.py --limit 10 # or a subset, best-ranked first
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autopilot.cadence import assign_variant  # noqa: E402
from autopilot.config import settings  # noqa: E402
from autopilot.models import Lead, Status  # noqa: E402
from autopilot.pipeline import qa_demo  # noqa: E402
from autopilot.sitegen import build_site  # noqa: E402
from autopilot.store import LeadStore  # noqa: E402

# Conservative service inference: business-name keywords first (most
# specific), then category defaults that essentially every shop in that
# vertical offers. Anything beyond this needs per-lead research.
NAME_KEYWORDS = [
    ("tire", ["Tire Sales & Repair", "Flat Repair", "Rotation & Balancing"]),
    ("muffler", ["Muffler & Exhaust Service"]),
    ("radiator", ["Radiator Service & Repair"]),
    ("a/c", ["AC Service & Repair"]),
    ("mobile", ["Mobile Service — We Come to You"]),
    ("roadside", ["Roadside Assistance"]),
    ("towing", ["Towing"]),
    ("diesel", ["Diesel Repair"]),
    ("tree", ["Tree Trimming & Removal"]),
    ("lube", ["Oil Changes & Lube"]),
]

CATEGORY_DEFAULTS = {
    "auto_repair": ["General Auto Repair", "Diagnostics", "Brakes"],
    "plumbing": ["Plumbing Repairs", "Drain Cleaning", "Emergency Service"],
    "landscaping": ["Lawn Mowing", "Trimming & Cleanups", "Yard Maintenance"],
}


def infer_services(lead: Lead) -> list[str]:
    name = lead.business.name.lower()
    services: list[str] = []
    for kw, svc in NAME_KEYWORDS:
        if kw in name:
            for s in svc:
                if s not in services:
                    services.append(s)
    for s in CATEGORY_DEFAULTS.get(lead.business.category, []):
        if s not in services:
            services.append(s)
    return services[:6]


def grounded_copy(lead: Lead) -> dict:
    """Copy built ONLY from verified fields — no owner names, no invented
    quotes, no years-in-business. The refined ($) version personalizes."""
    b = lead.business
    cat_h = b.category.replace("_", " ").title()
    services = infer_services(lead)
    review_line = (
        f"Rated {b.rating}★ across {b.review_count} Google reviews."
        if b.rating > 0 else "Trusted by local customers."
    )
    return {
        "headline": f"{b.city}'s {b.rating}★ {cat_h} Team" if b.rating >= 4.8
                    else f"Trusted {cat_h} in {b.city}",
        "subhead": review_line + " Call today — fast, local, and fair.",
        "about": (
            f"{b.name} serves {b.city}, {b.state} with dependable "
            f"{b.category.replace('_', ' ')} service. {review_line} "
            f"Call {b.phone} for a quote."
        ),
        "services": [
            {"name": s, "blurb": f"{s} handled promptly at a fair price."}
            for s in services
        ],
        "cta": "Call Now",
        "review": review_line,
    }


SUBJECT = "{count} Google reviews and no website — so I built {name} one"
EMAIL_TEMPLATE = """Hi{owner},

I was looking up {city} {vertical} businesses and {name} stood out —
{count} Google reviews at {rating} stars — but when I searched for your
website, there wasn't one. So I built it: your services, your reviews,
and a request form that goes straight to your phone. Free to look:

    [PREVIEW LINK]

If you like it, a one-time ${price} gets you a refined version — your
photos, your wording, any changes you want — live on your own domain.
If not, no hard feelings; the preview just comes down.

— [YOUR NAME]
{brand} · [POSTAL ADDRESS]
Reply STOP and I won't email again."""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 = all NEW leads")
    args = ap.parse_args()

    settings.ensure_dirs()
    store = LeadStore()
    leads = [l for l in store.by_status(Status.NEW)
             if not l.presence.has_site and l.business.phone]
    leads.sort(key=lambda l: (-l.business.rating, -l.business.review_count))
    if args.limit:
        leads = leads[: args.limit]

    sheet_path = settings.data_dir / "pilots" / "call-sheet.csv"
    sheet_path.parent.mkdir(parents=True, exist_ok=True)
    built = 0
    with open(sheet_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["rank", "business", "category", "city", "phone", "rating",
                    "reviews", "variant", "demo_path", "suggested_subject",
                    "services_inferred_VERIFY_BEFORE_SENDING"])
        for rank, lead in enumerate(leads, 1):
            lead.enrichment.services = infer_services(lead)
            copy = grounded_copy(lead)
            passed, notes = qa_demo(lead, copy)
            demo = build_site(lead, copy)
            demo.qa_passed = passed
            demo.qa_notes = notes
            lead.demo = demo
            lead.cadence.variant = assign_variant(lead.id)
            lead.status = (Status.DEMO_BUILT.value if passed
                           else Status.QUALIFIED.value)
            lead.note(f"batch demo built (rank {rank}, QA "
                      f"{'PASS' if passed else notes})")
            store.upsert(lead)
            built += 1
            w.writerow([
                rank, lead.business.name, lead.business.category,
                lead.business.city, lead.business.phone, lead.business.rating,
                lead.business.review_count, lead.cadence.variant, demo.path,
                SUBJECT.format(count=lead.business.review_count,
                               name=lead.business.name),
                "; ".join(lead.enrichment.services),
            ])

    print(f"Built {built} demos → {settings.demos_dir}")
    print(f"Call sheet → {sheet_path}")

    tmpl_path = settings.data_dir / "pilots" / "outreach-template.txt"
    tmpl_path.write_text(
        "GENERIC OUTREACH TEMPLATE (per-lead subjects in call-sheet.csv)\n"
        "Fill: [PREVIEW LINK], [YOUR NAME], [POSTAL ADDRESS], {owner} if known.\n"
        "Verify inferred services on each demo before sending.\n\n"
        + EMAIL_TEMPLATE.format(owner="", city="{city}", vertical="{vertical}",
                                name="{name}", count="{count}",
                                rating="{rating}",
                                price=settings.price_one_time,
                                brand=settings.brand)
        + "\n\nTEXT (send AFTER a call where they say 'text me the link'):\n"
        "Here's that link — the website I built for {name}: [PREVIEW LINK]. "
        f"Free to look. Refined + your own domain: one-time "
        f"${settings.price_one_time}. — [NAME], {settings.brand}\n",
        encoding="utf-8")
    print(f"Outreach template → {tmpl_path}")


if __name__ == "__main__":
    main()
