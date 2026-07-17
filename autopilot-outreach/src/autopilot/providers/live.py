"""Live provider stubs.

These are intentionally thin: each documents the exact real API it maps to and
raises a clear error until you implement it + supply keys. This keeps mock mode
dependency-free (nothing here is imported unless APOP_MODE=live) while giving
you a precise checklist of what "going live" requires.

Fill these in incrementally — the pipeline will start working for each stage as
soon as its provider returns real data.
"""
from __future__ import annotations

from ..config import settings
from ..models import Lead
from .base import (
    ContentWriter,
    DiscoveryProvider,
    EmailProvider,
    EnrichmentProvider,
    PaymentProvider,
    PresenceProvider,
    VoiceProvider,
)


class _NotWired(NotImplementedError):
    """Raised by live stubs that haven't been implemented yet."""


class GooglePlacesDiscovery(DiscoveryProvider):
    """Google Places API (New): places:searchText / :searchNearby + Place Details.

    Tile the metro into overlapping search circles, page results (~60/query),
    dedupe by place_id. Endpoint: POST https://places.googleapis.com/v1/places:searchText
    Header: X-Goog-Api-Key. FieldMask controls cost — request only what you use.
    """

    def search(self, city: str, category: str, limit: int) -> list[Lead]:
        if not settings.google_places_key:
            raise _NotWired("Set GOOGLE_PLACES_API_KEY and implement searchText.")
        raise _NotWired("GooglePlacesDiscovery.search not implemented yet.")


class HeadlessPresence(PresenceProvider):
    """Fetch the lead's site headless (Playwright — already available here),
    run Lighthouse for Core Web Vitals, screenshot for a vision-model 'looks
    dated?' score. Produce presence.score + category + issues."""

    def analyze(self, lead: Lead) -> None:
        raise _NotWired("HeadlessPresence.analyze not implemented yet.")


class BrokerEnrichment(EnrichmentProvider):
    """Owner name / email / mobile from a data broker (Apollo, Data Axle,
    Clearbit) + services/reviews parsed from their GBP/Yelp/existing site."""

    def enrich(self, lead: Lead) -> None:
        raise _NotWired("BrokerEnrichment.enrich not implemented yet.")


class LLMContentWriter(ContentWriter):
    """Grounded site copy via an LLM (Claude/GPT). Feed enrichment data; require
    it to only use provided facts (no hallucinated services). Return the same
    dict shape as MockContentWriter so sitegen is provider-agnostic."""

    def write_copy(self, lead: Lead) -> dict:
        if not (settings.anthropic_key or settings.openai_key):
            raise _NotWired("Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
        raise _NotWired("LLMContentWriter.write_copy not implemented yet.")


class SMTPEmail(EmailProvider):
    """Transactional email (Postmark/SES/SendGrid). Warm the domain, set SPF/
    DKIM/DMARC, honor unsubscribe (CAN-SPAM). Return the provider message id."""

    def send(self, lead: Lead, subject: str, body: str) -> str:
        raise _NotWired("SMTPEmail.send not implemented yet.")


class VapiVoice(VoiceProvider):
    """Outbound AI voice via Vapi/Retell (or Twilio+Deepgram+ElevenLabs).

    MUST: open with the AI-disclosure line, honor DNC/opt-out instantly,
    respect local calling hours, record only where lawful. Warm-transfer hot
    leads to a human closer."""

    def call(self, lead: Lead) -> dict:
        raise _NotWired("VapiVoice.call not implemented yet.")


class StripePayment(PaymentProvider):
    """Stripe Checkout / Payment Links for the one-time fee + a subscription for
    hosting/maintenance. Confirm via webhook, not client redirect."""

    def charge(self, lead: Lead, amount: int) -> bool:
        if not settings.stripe_key:
            raise _NotWired("Set STRIPE_API_KEY.")
        raise _NotWired("StripePayment.charge not implemented yet.")
