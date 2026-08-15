"""Outreach cadence: the multi-day touch plan, A/B variant assignment, and the
copy for every email/voice touch.

The campaign clock is measured in *days since demo built* (day 0). run_campaign
simulates the whole timeline in one process; in production each tick would be a
scheduled job (cron/Temporal timer) using real dates.

A/B testing: each lead is deterministically assigned variant "A" or "B" from a
CRC of its id (stable across runs — no RNG state to corrupt). The variant picks
the intro-email subject and the voice-call opener; conversion stats per variant
surface in `run.py stats` and the dashboard so you can see which hook wins.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass

from .config import settings
from .models import Lead


@dataclass(frozen=True)
class Touch:
    day: int
    channel: str    # email | voice
    kind: str       # intro | call | followup | breakup


# Day 0: intro email with the demo link (lowest-risk channel first).
# Day 1: voice call (only fires if compliance gates pass).
# Day 3: follow-up email for non-responders.
# Day 7: honest final email — no fake urgency; the preview simply stays up.
TOUCH_PLAN: list[Touch] = [
    Touch(0, "email", "intro"),
    Touch(1, "voice", "call"),
    Touch(3, "email", "followup"),
    Touch(7, "email", "breakup"),
]

# Days run_campaign simulates (the distinct days in the plan).
CAMPAIGN_DAYS: list[int] = sorted({t.day for t in TOUCH_PLAN})


def assign_variant(lead_id: str) -> str:
    """Deterministic 50/50 split, stable across processes (crc32, not hash())."""
    return "A" if zlib.crc32(lead_id.encode("utf-8")) % 2 == 0 else "B"


# ---------------------------------------------------------------------------
# Email copy
# ---------------------------------------------------------------------------
def _first(lead: Lead) -> str:
    return lead.contacts.owner_name.split()[0] if lead.contacts.owner_name else "there"


def _footer() -> str:
    # CAN-SPAM requires a physical postal address in commercial email. Render
    # an unmissable placeholder rather than silently repeating the brand.
    postal = settings.postal_address or "[POSTAL ADDRESS REQUIRED BEFORE SENDING — CAN-SPAM]"
    return f"\n\n— {settings.brand} · {postal}\nReply STOP to opt out."


def price_offer() -> str:
    """The keep-it line, switching to free-first phrasing when APOP_PRICE=0."""
    if settings.price_one_time <= 0:
        return ("And it's yours free — no catch, no invoice. If you like it, "
                "I'll even help you put it on your own domain.")
    monthly = (f" plus ${settings.price_monthly}/mo hosting"
               if settings.price_monthly > 0 else
               " and I'll put it live on your own domain for you")
    return (f"If you like it, it's a one-time ${settings.price_one_time} to "
            f"keep{monthly}. If not, no worries at all.")


def render_email(lead: Lead, kind: str, variant: str) -> tuple[str, str]:
    """Return (subject, body) for an email touch, personalized + variant-aware."""
    b = lead.business
    first = _first(lead)
    url = lead.demo.preview_url

    if kind == "intro":
        if variant == "A":  # curiosity hook
            subject = f"I built {b.name} a new website — it's free to look at"
        else:               # pain hook — MUST stay truthful per presence state
            if lead.presence.has_site:
                subject = (f"{b.name}'s website may be costing you customers — "
                           f"so I built you a new one")
            else:
                subject = f"{b.city} customers can't find {b.name} online — so I fixed that"
        # Opening claim must match what we actually verified about their
        # presence — unverified audits get the claim-free version.
        inconclusive = any("INCONCLUSIVE" in i for i in lead.presence.issues)
        if not lead.presence.has_site:
            opener = (f"I noticed {b.name} doesn't have a website yet, so I "
                      f"went ahead and built you one — modern and mobile-friendly.")
        elif inconclusive:
            opener = (f"I build websites for local service businesses, and I "
                      f"made one for {b.name} — finished, real, and ready to look at.")
        else:
            opener = (f"I noticed {b.name}'s website could use a refresh, so I "
                      f"went ahead and built you a new one — modern and mobile-friendly.")
        body = (
            f"Hi {first},\n\n"
            f"{opener} It's live for you to preview — free, no obligation:\n\n"
            f"    {url}\n\n"
            f"{price_offer()}{_footer()}"
        )
    elif kind == "followup":
        subject = f"Re: your new {b.name} website"
        body = (
            f"Hi {first},\n\n"
            f"Just floating this back up — did you get a chance to look at the "
            f"site I built for {b.name}?\n\n    {url}\n\n"
            f"If anything looks off (wrong hours, missing service, photos), "
            f"reply and I'll fix it before you decide anything.{_footer()}"
        )
    else:  # breakup — honest close-out, no manufactured urgency
        subject = f"Last note about the {b.name} site"
        body = (
            f"Hi {first},\n\n"
            f"I'll stop emailing after this one. The preview stays up for "
            f"another 30 days if you ever want to take a look:\n\n    {url}\n\n"
            f"If it's ever useful, I'm one reply away. Best of luck with the "
            f"business either way.{_footer()}"
        )
    return subject, body


# ---------------------------------------------------------------------------
# Voice script
# ---------------------------------------------------------------------------
def voice_script(lead: Lead, variant: str) -> dict:
    """Structured script handed to the voice provider. The provider MUST open
    with the AI disclosure (compliance.AI_DISCLOSURE_LINE) before this hook."""
    b = lead.business
    if variant == "A":
        opener = (f"I actually already built a brand-new website for {b.name} — "
                  f"it's live for you to look at, free. Can I text you the link?")
    elif lead.presence.has_site:
        # Truthful for redesign targets: they HAVE a site, it's just dated.
        opener = (f"I came across {b.name}'s website and thought it deserved a "
                  f"refresh, so I went ahead and built you a new one — costs "
                  f"nothing to look. Can I text you the link?")
    else:
        opener = (f"I was looking for {b.name} online and couldn't find a "
                  f"website, so I went ahead and made one for you — costs "
                  f"nothing to look. Can I text you the link?")
    return {"variant": variant, "opener": opener}


# ---------------------------------------------------------------------------
# A/B stats
# ---------------------------------------------------------------------------
def ab_stats(leads: list[Lead]) -> dict[str, dict]:
    """Per-variant funnel stats. Only leads that entered outreach count."""
    stats: dict[str, dict] = {}
    for lead in leads:
        v = lead.cadence.variant
        if not v:
            continue
        s = stats.setdefault(v, {
            "leads": 0, "emails": 0, "calls": 0,
            "interested": 0, "converted": 0, "revenue": 0,
        })
        s["leads"] += 1
        for a in lead.outreach:
            if a.channel == "email":
                s["emails"] += 1
            elif a.channel == "voice":
                s["calls"] += 1
        if lead.status in {"INTERESTED", "CONVERTED", "LIVE"}:
            s["interested"] += 1
        if lead.billing.paid:
            s["converted"] += 1
            s["revenue"] += lead.billing.quote
    return stats
