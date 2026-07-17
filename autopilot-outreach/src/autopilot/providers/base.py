"""Provider interfaces + a factory that selects mock vs. live implementations.

Every external dependency (business discovery, enrichment, content writing,
email, voice, payment) is behind one of these ABCs. The pipeline only ever
talks to the interface, so switching APOP_MODE from "mock" to "live" — or
swapping one vendor for another — never touches pipeline code.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..models import Lead


class DiscoveryProvider(ABC):
    @abstractmethod
    def search(self, city: str, category: str, limit: int) -> list[Lead]:
        """Return raw leads for a (city, vertical) query."""


class PresenceProvider(ABC):
    @abstractmethod
    def analyze(self, lead: Lead) -> None:
        """Populate lead.presence in place (has_site, score, category, issues)."""


class EnrichmentProvider(ABC):
    @abstractmethod
    def enrich(self, lead: Lead) -> None:
        """Populate contacts + enrichment (owner, emails, services, reviews)."""


class ContentWriter(ABC):
    @abstractmethod
    def write_copy(self, lead: Lead) -> dict:
        """Return a dict of site copy (headline, subhead, about, service blurbs).

        Mock = rule-based templating. Live = an LLM grounded in enrichment data.
        """


class EmailProvider(ABC):
    @abstractmethod
    def send(self, lead: Lead, subject: str, body: str) -> str:
        """Send (or simulate) an email; return an artifact path/id."""


class VoiceProvider(ABC):
    @abstractmethod
    def call(self, lead: Lead) -> dict:
        """Place (or simulate) a call; return {disposition, transcript, artifact}."""


class PaymentProvider(ABC):
    @abstractmethod
    def charge(self, lead: Lead, amount: int) -> bool:
        """Collect payment (or simulate). Return True on success."""


# --------------------------------------------------------------------------
# Factory
# --------------------------------------------------------------------------
def build_providers(mode: Optional[str] = None) -> dict:
    """Return a dict of instantiated providers for the given mode.

    Kept as a plain dict (not a class) so tests can override individual
    providers trivially: providers["voice"] = MyFakeVoice().
    """
    from ..config import settings
    from . import mock as m

    use_mock = (mode or settings.mode).lower() == "mock"

    if use_mock:
        return {
            "discovery": m.MockDiscovery(),
            "presence": m.MockPresence(),
            "enrichment": m.MockEnrichment(),
            "content": m.MockContentWriter(),
            "email": m.MockEmail(),
            "voice": m.MockVoice(),
            "payment": m.MockPayment(),
        }

    # Live mode: import lazily so mock runs never need real SDKs/keys.
    from . import live as lv

    return {
        "discovery": lv.GooglePlacesDiscovery(),
        "presence": lv.HeadlessPresence(),
        "enrichment": lv.BrokerEnrichment(),
        "content": lv.LLMContentWriter(),
        "email": lv.SMTPEmail(),
        "voice": lv.VapiVoice(),
        "payment": lv.StripePayment(),
    }
