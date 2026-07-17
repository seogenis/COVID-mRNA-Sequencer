"""Domain model for a lead as it moves through the pipeline.

A Lead is one long-running stateful record. The `status` field is the state
machine that the orchestrator advances. Everything is a plain dataclass that
serializes to/from JSON so the store stays simple (sqlite + a JSON blob).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Optional


class Status(str, Enum):
    NEW = "NEW"
    QUALIFIED = "QUALIFIED"
    REJECTED = "REJECTED"          # filtered out (has a good site, on DNC, etc.)
    DEMO_BUILT = "DEMO_BUILT"
    CONTACTED = "CONTACTED"
    INTERESTED = "INTERESTED"
    CONVERTED = "CONVERTED"        # paid
    LIVE = "LIVE"                  # deployed to their domain
    DEAD = "DEAD"                  # exhausted attempts / hard no


# Terminal states the orchestrator will not advance further.
TERMINAL = {Status.REJECTED, Status.CONVERTED, Status.LIVE, Status.DEAD}


class PresenceCategory(str, Enum):
    NO_SITE = "no_site"
    OUTDATED = "outdated"
    DECENT = "decent"
    GOOD = "good"


@dataclass
class Business:
    name: str = ""
    category: str = ""            # vertical key, e.g. "landscaping"
    phone: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    lat: float = 0.0
    lng: float = 0.0
    rating: float = 0.0
    review_count: int = 0
    hours: str = ""
    timezone: str = "America/Chicago"


@dataclass
class Presence:
    has_site: bool = False
    url: str = ""
    score: int = 0                # 0-100, higher = better existing presence
    category: str = PresenceCategory.NO_SITE.value
    issues: list[str] = field(default_factory=list)


@dataclass
class Contacts:
    owner_name: str = ""
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    socials: list[str] = field(default_factory=list)


@dataclass
class Enrichment:
    services: list[str] = field(default_factory=list)
    review_summary: str = ""
    tagline: str = ""


@dataclass
class Demo:
    preview_url: str = ""
    template_id: str = ""
    built_at: str = ""
    path: str = ""                # local filesystem path to index.html
    qa_passed: bool = False
    qa_notes: list[str] = field(default_factory=list)


@dataclass
class OutreachAttempt:
    channel: str = ""             # email | voice | sms
    at: str = ""
    disposition: str = ""         # sent | no_answer | interested | not_interested | dnc
    artifact: str = ""            # path to transcript / email file


@dataclass
class Billing:
    quote: int = 0
    paid: bool = False
    paid_at: str = ""
    method: str = ""


@dataclass
class Compliance:
    dnc_checked: bool = False
    on_dnc: bool = False
    within_call_hours: bool = True
    ai_disclosure_given: bool = False


@dataclass
class Lead:
    id: str
    source: str = ""
    discovered_at: str = ""
    status: str = Status.NEW.value
    business: Business = field(default_factory=Business)
    presence: Presence = field(default_factory=Presence)
    contacts: Contacts = field(default_factory=Contacts)
    enrichment: Enrichment = field(default_factory=Enrichment)
    demo: Demo = field(default_factory=Demo)
    outreach: list[OutreachAttempt] = field(default_factory=list)
    billing: Billing = field(default_factory=Billing)
    compliance: Compliance = field(default_factory=Compliance)
    log: list[str] = field(default_factory=list)

    # ---- serialization helpers -------------------------------------------
    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)

    @staticmethod
    def from_json(raw: str) -> "Lead":
        d: dict[str, Any] = json.loads(raw)
        return Lead(
            id=d["id"],
            source=d.get("source", ""),
            discovered_at=d.get("discovered_at", ""),
            status=d.get("status", Status.NEW.value),
            business=Business(**d.get("business", {})),
            presence=Presence(**d.get("presence", {})),
            contacts=Contacts(**d.get("contacts", {})),
            enrichment=Enrichment(**d.get("enrichment", {})),
            demo=Demo(**d.get("demo", {})),
            outreach=[OutreachAttempt(**a) for a in d.get("outreach", [])],
            billing=Billing(**d.get("billing", {})),
            compliance=Compliance(**d.get("compliance", {})),
            log=d.get("log", []),
        )

    def note(self, msg: str) -> None:
        """Append a human-readable audit line — this is your debug trail."""
        self.log.append(msg)
