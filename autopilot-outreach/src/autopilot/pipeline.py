"""The orchestrator. Advances each lead through the funnel state machine:

  NEW → QUALIFIED → DEMO_BUILT → CONTACTED → INTERESTED → CONVERTED
        (or REJECTED / DEAD at any gate)

Each stage is small, idempotent, and appends to lead.log so you can trace
exactly what happened to any lead (great for debugging). The whole thing runs
synchronously and deterministically in mock mode.

In production each stage would be a durable-workflow activity (Temporal) with
retries and human-in-the-loop pauses; the logic here is the same.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .compliance import outreach_allowed
from .config import settings
from .models import Lead, PresenceCategory, Status
from .providers import build_providers
from .sitegen import build_site


def _local_hour() -> int:
    # Mock: use current UTC hour. Live: convert to the lead's timezone.
    return datetime.now(timezone.utc).hour


def qa_demo(lead: Lead, copy: dict) -> tuple[bool, list[str]]:
    """Deterministic QA gate before a demo is allowed into outreach.

    Catches the obvious failure modes (empty copy, hallucinated services not
    grounded in enrichment). In live mode add a Lighthouse threshold + an
    LLM-as-judge pass; anything failing routes to a human review queue.
    """
    notes: list[str] = []
    if not copy.get("headline"):
        notes.append("missing headline")
    if not copy.get("services"):
        notes.append("no services rendered")
    grounded = set(lead.enrichment.services)
    for s in copy.get("services", []):
        if grounded and s["name"] not in grounded:
            notes.append(f"ungrounded service: {s['name']}")
    return (len(notes) == 0, notes)


class Pipeline:
    def __init__(self, store, providers=None) -> None:
        self.store = store
        self.p = providers or build_providers()

    # ---- stage 1: discovery ---------------------------------------------
    def discover(self, city: str, category: str, limit: int) -> list[Lead]:
        leads = self.p["discovery"].search(city, category, limit)
        for lead in leads:
            lead.note(f"discovered via {lead.source}")
            self.store.upsert(lead)
        return leads

    # ---- stages 2-3: presence + enrich + qualify ------------------------
    def qualify(self, lead: Lead) -> Lead:
        self.p["presence"].analyze(lead)
        lead.note(f"presence={lead.presence.category} score={lead.presence.score}")

        target = lead.presence.category in {
            PresenceCategory.NO_SITE.value, PresenceCategory.OUTDATED.value
        } and lead.presence.score <= settings.max_presence_score

        if not target:
            lead.status = Status.REJECTED.value
            lead.note("rejected: existing web presence is good enough")
            self.store.upsert(lead)
            return lead

        self.p["enrichment"].enrich(lead)
        lead.note(f"enriched: {len(lead.enrichment.services)} services, "
                  f"owner={lead.contacts.owner_name}")
        lead.status = Status.QUALIFIED.value
        self.store.upsert(lead)
        return lead

    # ---- stage 4: site generation + QA ----------------------------------
    def build_demo(self, lead: Lead) -> Lead:
        copy = self.p["content"].write_copy(lead)
        passed, notes = qa_demo(lead, copy)
        demo = build_site(lead, copy)
        demo.qa_passed = passed
        demo.qa_notes = notes
        lead.demo = demo
        if passed:
            lead.status = Status.DEMO_BUILT.value
            lead.note(f"demo built + QA passed → {demo.preview_url}")
        else:
            lead.note(f"demo built but QA FAILED {notes} → human review queue")
        self.store.upsert(lead)
        return lead

    # ---- stage 5: outreach ----------------------------------------------
    def outreach(self, lead: Lead) -> Lead:
        allowed, reason = outreach_allowed(lead, _local_hour(), channel="email")
        if not allowed:
            lead.status = Status.DEAD.value if reason == "on_dnc" else lead.status
            lead.note(f"outreach blocked: {reason}")
            self.store.upsert(lead)
            return lead

        # Channel 1: email the demo link (lowest legal risk).
        subject = f"I built {lead.business.name} a new website — free to view"
        body = (
            f"Hi {lead.contacts.owner_name.split()[0]},\n\n"
            f"I noticed {lead.business.name} could use a refreshed web presence, "
            f"so I went ahead and built you a modern, mobile-friendly site. "
            f"It's live for you to preview — free, no obligation:\n\n"
            f"    {lead.demo.preview_url}\n\n"
            f"If you like it, it's ${settings.price_one_time} to keep it, plus "
            f"${settings.price_monthly}/mo hosting. If not, no worries at all.\n\n"
            f"— Autopilot Web\n\nReply STOP to opt out."
        )
        self.p["email"].send(lead, subject, body)
        lead.note("emailed demo link")

        # Channel 2: AI voice call (gated again for call-hours/DNC).
        allowed_voice, vreason = outreach_allowed(lead, _local_hour(), channel="voice")
        if allowed_voice:
            result = self.p["voice"].call(lead)
            lead.note(f"voice call → {result['disposition']}")
            if result["disposition"] == "interested":
                lead.status = Status.INTERESTED.value
            elif result["disposition"] == "not_interested":
                lead.status = Status.DEAD.value
            else:
                lead.status = Status.CONTACTED.value
        else:
            lead.note(f"voice skipped: {vreason}")
            lead.status = Status.CONTACTED.value

        self.store.upsert(lead)
        return lead

    # ---- stage 6: conversion --------------------------------------------
    def convert(self, lead: Lead) -> Lead:
        lead.billing.quote = settings.price_one_time
        ok = self.p["payment"].charge(lead, settings.price_one_time)
        if ok:
            lead.status = Status.CONVERTED.value
            lead.note(f"PAID ${lead.billing.quote} — deploy to production next")
        else:
            lead.note("payment not completed — schedule follow-up")
        self.store.upsert(lead)
        return lead

    # ---- full run --------------------------------------------------------
    def run_campaign(self, city: str, category: str, limit: int) -> dict:
        """Run one full campaign end-to-end and return a summary."""
        leads = self.discover(city, category, limit)
        for lead in leads:
            self.qualify(lead)
            if lead.status != Status.QUALIFIED.value:
                continue
            self.build_demo(lead)
            if lead.status != Status.DEMO_BUILT.value:
                continue  # failed QA → human review
            self.outreach(lead)
            if lead.status == Status.INTERESTED.value:
                self.convert(lead)
        return self.summary()

    def summary(self) -> dict:
        counts = self.store.counts()
        return {
            "counts": counts,
            "revenue": self.store.revenue(),
            "total": sum(counts.values()),
        }
