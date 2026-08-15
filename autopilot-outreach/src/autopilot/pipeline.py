"""The orchestrator. Advances each lead through the funnel state machine:

  NEW → QUALIFIED → DEMO_BUILT → CONTACTED → INTERESTED → CONVERTED
        (or REJECTED / DEAD at any gate)

Outreach is cadence-driven (cadence.TOUCH_PLAN): intro email day 0, voice call
day 1, follow-up email day 3, honest breakup email day 7. `tick(day)` executes
every touch that is due; `run_campaign` simulates the full timeline in one
process. In production, ticks are scheduled jobs on real dates.

Each stage is small, idempotent, and appends to lead.log so you can trace
exactly what happened to any lead (`python run.py show <id>`).
"""
from __future__ import annotations

from datetime import datetime, timezone

from .cadence import (
    CAMPAIGN_DAYS,
    TOUCH_PLAN,
    Touch,
    assign_variant,
    render_email,
    voice_script,
)
from .compliance import outreach_allowed
from .config import settings
from .models import Lead, PresenceCategory, Status
from .providers import build_providers
from .sitegen import build_site

# Statuses still eligible for further cadence touches.
_ACTIVE = {Status.DEMO_BUILT.value, Status.CONTACTED.value}


def _local_hour() -> int:
    """Hour used for the calling-hours compliance gate.

    Mock mode uses a frozen 10:00 clock so runs are deterministic no matter
    when you execute them (a real-clock gate made night-time test runs silently
    skip the voice stage). Live mode must convert to the LEAD's timezone.
    """
    if settings.is_mock:
        return 10
    return datetime.now(timezone.utc).hour  # TODO(live): lead-local timezone


def qa_demo(lead: Lead, copy: dict) -> tuple[bool, list[str]]:
    """Deterministic QA gate before a demo is allowed into outreach.

    Catches the obvious failure modes (empty copy, hallucinated services not
    grounded in enrichment). In live mode add a Lighthouse threshold + an
    LLM-as-judge pass; anything failing routes to the human review queue.
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
        lead.cadence.variant = assign_variant(lead.id)
        if passed:
            lead.status = Status.DEMO_BUILT.value
            lead.note(f"demo built + QA passed → {demo.preview_url} "
                      f"(variant {lead.cadence.variant})")
        else:
            # Stays QUALIFIED → shows up in the dashboard's human review queue.
            lead.note(f"demo built but QA FAILED {notes} → human review queue")
        self.store.upsert(lead)
        return lead

    # ---- stage 5: cadence-driven outreach --------------------------------
    def execute_touch(self, lead: Lead, touch: Touch, day: int) -> None:
        variant = lead.cadence.variant or assign_variant(lead.id)
        allowed, reason = outreach_allowed(lead, _local_hour(), channel=touch.channel)
        if not allowed:
            if reason == "on_dnc":
                lead.status = Status.DEAD.value
                lead.cadence.stopped = True
                lead.cadence.stop_reason = "dnc"
            lead.note(f"day {day}: {touch.channel}/{touch.kind} blocked: {reason}")
            # A blocked call-hours touch is skipped, not retried, in the sim.
            lead.cadence.touch_index += 1
            self.store.upsert(lead)
            return

        if touch.channel == "email":
            subject, body = render_email(lead, touch.kind, variant)
            self.p["email"].send(lead, subject, body)
            if lead.status == Status.DEMO_BUILT.value:
                lead.status = Status.CONTACTED.value
            lead.note(f"day {day}: emailed {touch.kind} (variant {variant})")
        else:  # voice
            result = self.p["voice"].call(lead, voice_script(lead, variant))
            disposition = result.get("disposition", "no_answer")
            lead.note(f"day {day}: voice call → {disposition} (variant {variant})")
            if disposition == "interested":
                lead.status = Status.INTERESTED.value
                lead.cadence.stopped = True
                lead.cadence.stop_reason = "interested"
            elif disposition == "not_interested":
                lead.status = Status.DEAD.value
                lead.cadence.stopped = True
                lead.cadence.stop_reason = "declined"
            else:
                lead.status = Status.CONTACTED.value

        # Tag the attempt the provider just recorded with cadence metadata.
        if lead.outreach:
            lead.outreach[-1].variant = variant
            lead.outreach[-1].day = day
            lead.outreach[-1].kind = touch.kind

        lead.cadence.touch_index += 1
        lead.cadence.last_touch_day = day
        self.store.upsert(lead)

    def tick(self, day: int) -> int:
        """Execute every touch due on `day` for every active lead, then attempt
        conversion for any interested leads. Returns touches executed."""
        touched = 0
        # sorted() for stable cross-process iteration (str-set order is
        # randomized by PYTHONHASHSEED; determinism is a debugging feature).
        for status in sorted(_ACTIVE):
            for lead in self.store.by_status(status):
                c = lead.cadence
                while (not c.stopped
                       and c.touch_index < len(TOUCH_PLAN)
                       and TOUCH_PLAN[c.touch_index].day <= day
                       and lead.status in _ACTIVE):
                    self.execute_touch(lead, TOUCH_PLAN[c.touch_index], day)
                    touched += 1

        # Conversion attempt for newly interested leads (once per lead).
        for lead in self.store.by_status(Status.INTERESTED):
            if lead.billing.quote == 0:
                self.convert(lead)
        return touched

    # ---- stage 6: conversion --------------------------------------------
    def convert(self, lead: Lead) -> Lead:
        lead.billing.quote = settings.price_one_time
        ok = self.p["payment"].charge(lead, settings.price_one_time)
        if ok:
            lead.status = Status.CONVERTED.value
            lead.note(f"PAID ${lead.billing.quote} — deploy to production next")
        else:
            # Stays INTERESTED with a quote set → dashboard close queue.
            lead.note("payment not completed — in close queue for human follow-up")
        self.store.upsert(lead)
        return lead

    # ---- full run --------------------------------------------------------
    def run_campaign(self, city: str, category: str, limit: int) -> dict:
        """Discover/qualify/build, then simulate the full cadence timeline."""
        leads = self.discover(city, category, limit)
        for lead in leads:
            self.qualify(lead)
            if lead.status == Status.QUALIFIED.value:
                self.build_demo(lead)

        touches = 0
        for day in CAMPAIGN_DAYS:
            touches += self.tick(day)

        summary = self.summary()
        summary["touches"] = touches
        summary["days_simulated"] = CAMPAIGN_DAYS
        return summary

    def summary(self) -> dict:
        counts = self.store.counts()
        return {
            "counts": counts,
            "revenue": self.store.revenue(),
            "total": sum(counts.values()),
        }
