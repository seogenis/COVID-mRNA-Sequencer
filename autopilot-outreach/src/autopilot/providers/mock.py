"""Mock providers — deterministic, offline, no API keys.

These make the whole system testable end-to-end. Randomness is seeded from
settings.seed so every run is reproducible; change APOP_SEED to get a different
but still-deterministic dataset.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone

from ..compliance import AI_DISCLOSURE_LINE
from ..config import settings
from ..models import (
    Business,
    Contacts,
    Enrichment,
    Lead,
    OutreachAttempt,
    Presence,
    PresenceCategory,
)
from .base import (
    ContentWriter,
    DiscoveryProvider,
    EmailProvider,
    EnrichmentProvider,
    PaymentProvider,
    PresenceProvider,
    VoiceProvider,
)

# ---- fake data vocab ------------------------------------------------------
_FIRST = ["Joe", "Maria", "Dave", "Priya", "Sam", "Linda", "Carlos", "Grace",
          "Tom", "Aisha", "Nate", "Wei", "Rosa", "Ken", "Deb"]
_LAST = ["Martinez", "Nguyen", "Johnson", "Patel", "Kowalski", "Brooks",
         "Reyes", "Okafor", "Sullivan", "Cho", "Bauer", "Flores"]

_VERTICALS = {
    "landscaping": {
        "suffixes": ["Landscaping", "Lawn & Garden", "Outdoor Services", "Lawn Care"],
        "services": ["Lawn Mowing", "Landscape Design", "Tree Trimming",
                     "Mulching", "Sprinkler Repair", "Seasonal Cleanup"],
        "tagline": "Your yard, beautifully maintained.",
    },
    "auto_repair": {
        "suffixes": ["Auto Repair", "Automotive", "Car Care", "Garage"],
        "services": ["Oil Changes", "Brake Service", "Engine Diagnostics",
                     "Tire Rotation", "AC Repair", "State Inspections"],
        "tagline": "Honest repairs, done right the first time.",
    },
    "plumbing": {
        "suffixes": ["Plumbing", "Plumbing & Drain", "Rooter Service"],
        "services": ["Drain Cleaning", "Water Heater Install", "Leak Repair",
                     "Fixture Install", "Sewer Line", "Emergency Service"],
        "tagline": "Fast, reliable plumbing — 24/7.",
    },
}

_CITIES = [("Austin", "TX", "America/Chicago"),
           ("Phoenix", "AZ", "America/Phoenix"),
           ("Denver", "CO", "America/Denver")]

_STREETS = ["Main St", "Oak Ave", "Elm Rd", "Sunset Blvd", "Cedar Ln",
            "2nd St", "Industrial Way", "Park Dr"]


def _rng() -> random.Random:
    return random.Random(settings.seed)


def _now() -> str:
    # timezone-aware UTC stamp; deterministic ordering handled by the store.
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class MockDiscovery(DiscoveryProvider):
    def search(self, city: str, category: str, limit: int) -> list[Lead]:
        rng = _rng()
        vocab = _VERTICALS.get(category, _VERTICALS["landscaping"])
        cityname, state, tz = next(
            (c for c in _CITIES if c[0].lower() == city.lower()), _CITIES[0]
        )
        leads: list[Lead] = []
        for i in range(limit):
            owner = f"{rng.choice(_FIRST)} {rng.choice(_LAST)}"
            biz_name = f"{owner.split()[0]}'s {rng.choice(vocab['suffixes'])}"
            phone = f"({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(0,9999):04d}"
            lead = Lead(
                id=f"{category[:3]}-{city[:3].lower()}-{i:03d}",
                source="mock_places",
                discovered_at=_now(),
                business=Business(
                    name=biz_name,
                    category=category,
                    phone=phone,
                    address=f"{rng.randint(100,9999)} {rng.choice(_STREETS)}",
                    city=cityname,
                    state=state,
                    lat=round(30 + rng.random(), 5),
                    lng=round(-97 - rng.random(), 5),
                    rating=round(rng.uniform(3.4, 5.0), 1),
                    review_count=rng.randint(3, 240),
                    hours="Mon-Fri 8am-6pm, Sat 9am-2pm",
                    timezone=tz,
                ),
                contacts=Contacts(owner_name=owner),
            )
            leads.append(lead)
        return leads


class MockPresence(PresenceProvider):
    """Deterministically assign a web-presence profile.

    Distribution is intentionally weighted toward targets (no_site/outdated)
    so the demo funnel has plenty to work with.
    """

    def analyze(self, lead: Lead) -> None:
        rng = random.Random(f"{settings.seed}:{lead.id}")
        roll = rng.random()
        slug = lead.business.name.lower().replace("'", "").replace(" ", "")
        if roll < 0.40:  # no site at all
            lead.presence = Presence(
                has_site=False, url="", score=rng.randint(0, 15),
                category=PresenceCategory.NO_SITE.value,
                issues=["No website found", "Only a Facebook page"],
            )
        elif roll < 0.75:  # outdated site
            lead.presence = Presence(
                has_site=True, url=f"http://www.{slug}.example",
                score=rng.randint(20, 54),
                category=PresenceCategory.OUTDATED.value,
                issues=["Not mobile-friendly", "No HTTPS", "Slow load (5.8s)",
                        "No online booking", "Copyright 2011"],
            )
        elif roll < 0.90:  # decent
            lead.presence = Presence(
                has_site=True, url=f"https://{slug}.example",
                score=rng.randint(56, 78),
                category=PresenceCategory.DECENT.value,
                issues=["Weak call-to-action"],
            )
        else:  # good — will be rejected as a target
            lead.presence = Presence(
                has_site=True, url=f"https://{slug}.example",
                score=rng.randint(80, 97),
                category=PresenceCategory.GOOD.value, issues=[],
            )


class MockEnrichment(EnrichmentProvider):
    def enrich(self, lead: Lead) -> None:
        rng = random.Random(f"{settings.seed}:enrich:{lead.id}")
        vocab = _VERTICALS.get(lead.business.category, _VERTICALS["landscaping"])
        n = rng.randint(3, len(vocab["services"]))
        lead.enrichment = Enrichment(
            services=rng.sample(vocab["services"], n),
            review_summary=(
                f"Customers praise {lead.contacts.owner_name.split()[0]}'s "
                f"punctuality and fair pricing ({lead.business.rating}★, "
                f"{lead.business.review_count} reviews)."
            ),
            tagline=vocab["tagline"],
        )
        if not lead.contacts.emails:
            slug = lead.contacts.owner_name.split()[0].lower()
            dom = lead.business.name.lower().replace("'", "").replace(" ", "")
            lead.contacts.emails = [f"{slug}@{dom}.example"]
        if not lead.contacts.phones:
            lead.contacts.phones = [lead.business.phone]


class MockContentWriter(ContentWriter):
    """Rule-based stand-in for the LLM copy step. Produces specific, grounded
    copy from real enrichment data (not lorem)."""

    def write_copy(self, lead: Lead) -> dict:
        b, e = lead.business, lead.enrichment
        first = lead.contacts.owner_name.split()[0] if lead.contacts.owner_name else "We"
        return {
            "headline": f"{b.city}'s Trusted {b.category.replace('_', ' ').title()} Team",
            "subhead": e.tagline or "Quality service you can count on.",
            "about": (
                f"{b.name} has proudly served {b.city}, {b.state} with reliable "
                f"{b.category.replace('_', ' ')} services. Led by {first}, we treat "
                f"every job like it's for our own home."
            ),
            "services": [
                {"name": s, "blurb": f"Professional {s.lower()} with upfront pricing."}
                for s in (e.services or ["Service"])
            ],
            "cta": "Get a Free Quote",
            "review": e.review_summary,
        }


class MockEmail(EmailProvider):
    def send(self, lead: Lead, subject: str, body: str) -> str:
        settings.ensure_dirs()
        # Number artifacts per touch — a single path would overwrite earlier
        # emails and corrupt the audit trail.
        n = sum(1 for a in lead.outreach if a.channel == "email") + 1
        path = settings.outbox_dir / f"{lead.id}_email_{n}.txt"
        to = lead.contacts.emails[0] if lead.contacts.emails else "unknown@example"
        path.write_text(
            f"To: {to}\nSubject: {subject}\n\n{body}\n", encoding="utf-8"
        )
        lead.outreach.append(OutreachAttempt(
            channel="email", at=_now(), disposition="sent", artifact=str(path)))
        return str(path)


class MockVoice(VoiceProvider):
    """Simulates an outbound AI call and writes a scripted transcript.

    The disposition is deterministic per lead so tests are stable. The script
    always opens with the required AI disclosure line.
    """

    def call(self, lead: Lead, script: dict) -> dict:
        rng = random.Random(f"{settings.seed}:voice:{lead.id}")
        roll = rng.random()
        disclosure = AI_DISCLOSURE_LINE.format(company=settings.brand)

        # Disposition is seeded ONLY by lead id (not variant), so mock A/B
        # outcomes stay symmetric — the mock never fakes a winning variant.
        lines = [
            f"AGENT: {disclosure}",
            f"OWNER: Uh, sure, who is this?",
            f"AGENT: {script.get('opener', 'I built you a website — want the link?')}",
        ]
        if roll < 0.20:
            disposition, tail = "not_interested", [
                "OWNER: Not interested, thanks.",
                "AGENT: No problem at all — have a great day!",
            ]
        elif roll < 0.35:
            disposition, tail = "no_answer", ["[voicemail — dropped link via SMS]"]
        else:
            from ..cadence import price_offer
            disposition, tail = "interested", [
                "OWNER: Oh, really? Yeah, send it over.",
                f"AGENT: Sent! {price_offer()} No pressure — take a look first.",
                f"OWNER: Wow, that actually looks great. Let's talk.",
            ]
        transcript = "\n".join(lines + tail)
        settings.ensure_dirs()
        path = settings.outbox_dir / f"{lead.id}_call.txt"
        path.write_text(transcript, encoding="utf-8")
        lead.compliance.ai_disclosure_given = True
        lead.outreach.append(OutreachAttempt(
            channel="voice", at=_now(), disposition=disposition, artifact=str(path)))
        return {"disposition": disposition, "transcript": transcript, "artifact": str(path)}


class MockPayment(PaymentProvider):
    def charge(self, lead: Lead, amount: int) -> bool:
        # Deterministic: interested leads "pay" ~60% of the time in mock mode.
        rng = random.Random(f"{settings.seed}:pay:{lead.id}")
        ok = rng.random() < 0.60
        if ok:
            lead.billing.paid = True
            lead.billing.paid_at = _now()
            lead.billing.method = "mock_card"
        return ok
