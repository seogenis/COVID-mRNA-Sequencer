"""Live providers — real API integrations, stdlib-only (see http.py).

Each provider:
  * reads its keys from config.Settings (env vars),
  * raises ProviderNotReady with an actionable message when unconfigured
    (run `python run.py doctor` to see what's missing at a glance),
  * takes an injectable transport so its request-building and response-parsing
    logic is unit-tested offline (tests/test_live_providers.py).

Go-live order (docs/DESIGN.md §10): discovery → presence → content → email →
payment → voice LAST. Voice is deliberately double-gated (key + explicit
APOP_VOICE_ENABLED=1) because of TCPA exposure — see compliance.py.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

from ..compliance import AI_DISCLOSURE_LINE
from ..config import settings
from ..models import (
    Business,
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
from .http import HttpClient


class ProviderNotReady(RuntimeError):
    """Configuration missing / stage not yet enabled. Message says what to do."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Discovery — Google Places API (New)
# ---------------------------------------------------------------------------
class GooglePlacesDiscovery(DiscoveryProvider):
    """places:searchText with a cost-controlling FieldMask + pagination.

    Grid-tiling a metro for exhaustive coverage layers on top of this: run
    search() per tile and dedupe by place id (lead ids are derived from it).
    """

    ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
    FIELD_MASK = ",".join([
        "places.id", "places.displayName", "places.formattedAddress",
        "places.nationalPhoneNumber", "places.websiteUri", "places.rating",
        "places.userRatingCount", "places.location",
        "nextPageToken",
    ])

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def search(self, city: str, category: str, limit: int) -> list[Lead]:
        if not settings.google_places_key:
            raise ProviderNotReady(
                "Discovery not configured: set GOOGLE_PLACES_API_KEY "
                "(console.cloud.google.com → Places API (New)).")

        headers = {
            "X-Goog-Api-Key": settings.google_places_key,
            "X-Goog-FieldMask": self.FIELD_MASK,
        }
        query = f"{category.replace('_', ' ')} in {city}"
        leads: list[Lead] = []
        page_token: str | None = None

        while len(leads) < limit:
            body: dict = {"textQuery": query,
                          "pageSize": min(20, limit - len(leads))}
            if page_token:
                body["pageToken"] = page_token
            status, text = self.http.request("POST", self.ENDPOINT,
                                             headers=headers, json_body=body)
            if status != 200:
                raise RuntimeError(f"Places API error {status}: {text[:300]}")
            data = json.loads(text)
            for place in data.get("places", []):
                leads.append(self._to_lead(place, city, category))
                if len(leads) >= limit:
                    break
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return leads

    @staticmethod
    def _to_lead(place: dict, city: str, category: str) -> Lead:
        pid = place.get("id", "")
        short = hashlib.sha1(pid.encode()).hexdigest()[:10]
        loc = place.get("location", {})
        lead = Lead(
            id=f"gp-{short}",
            source="google_places",
            discovered_at=_now(),
            business=Business(
                name=place.get("displayName", {}).get("text", ""),
                category=category,
                phone=place.get("nationalPhoneNumber", ""),
                address=place.get("formattedAddress", ""),
                city=city,
                lat=loc.get("latitude", 0.0),
                lng=loc.get("longitude", 0.0),
                rating=place.get("rating", 0.0),
                review_count=place.get("userRatingCount", 0),
            ),
        )
        # Seed the presence URL so HeadlessPresence knows what to analyze.
        lead.presence.url = place.get("websiteUri", "")
        lead.presence.has_site = bool(lead.presence.url)
        return lead


# ---------------------------------------------------------------------------
# Presence — fetch + heuristic scoring
# ---------------------------------------------------------------------------
@dataclass
class FetchResult:
    status: int
    final_url: str
    html: str
    elapsed_ms: int


def _default_fetch(url: str, timeout: float = 15.0) -> FetchResult:
    # Share HttpClient's CA-aware SSL context: without it, environments that
    # route egress through a TLS-intercepting proxy fail verification and every
    # site falsely audits as "unreachable".
    from .http import _ca_bundle
    import ssl
    ctx = ssl.create_default_context(cafile=_ca_bundle())
    t0 = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SiteAudit/1.0)"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:  # nosec - audit fetch
        html = resp.read(2_000_000).decode("utf-8", "replace")
        return FetchResult(status=resp.status, final_url=resp.geturl(),
                           html=html, elapsed_ms=int((time.monotonic() - t0) * 1000))


class HeadlessPresence(PresenceProvider):
    """Deterministic heuristic audit of an existing site.

    Signals: loads at all, HTTPS, mobile viewport meta, copyright year, booking
    keywords, click-to-call, load time. Produces score 0-100 + issue list. A
    vision-LLM screenshot pass and Lighthouse can be layered on later — these
    heuristics alone already separate no_site / outdated / decent well.
    """

    def __init__(self, fetch=None) -> None:
        self.fetch = fetch or _default_fetch

    def analyze(self, lead: Lead) -> None:
        url = lead.presence.url
        if not url:
            lead.presence = Presence(
                has_site=False, url="", score=5,
                category=PresenceCategory.NO_SITE.value,
                issues=["No website listed on Google"])
            return
        try:
            result = self.fetch(url)
        except Exception as e:
            # Distinguish "THEIR site is down" from "OUR egress is blocked".
            # A proxy CONNECT refusal means we can't see out — concluding
            # "no site" from that would put false claims in outreach copy.
            reason = f"{e} {getattr(e, 'reason', '')}"
            if "tunnel" in reason.lower() or "forbidden" in reason.lower():
                lead.presence.has_site = True   # they listed one; trust that
                lead.presence.score = 50        # neutral — no evidence either way
                lead.presence.category = PresenceCategory.DECENT.value
                lead.presence.issues = [
                    "AUDIT INCONCLUSIVE: egress blocked from this environment "
                    "— do not make claims about this site in outreach"]
                return
            lead.presence = Presence(
                has_site=False, url=url, score=8,
                category=PresenceCategory.NO_SITE.value,
                issues=[f"Site unreachable ({type(e).__name__})"])
            return

        html = result.html.lower()
        issues: list[str] = []
        score = 30  # baseline: a site exists and loads

        if result.final_url.startswith("https://"):
            score += 10
        else:
            issues.append("No HTTPS")
        if "viewport" in html:
            score += 15
        else:
            issues.append("Not mobile-friendly (no viewport meta)")

        year_now = datetime.now(timezone.utc).year
        years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(\d{4})", html)]
        if years:
            newest = max(years)
            if newest >= year_now - 1:
                score += 10
            elif newest <= year_now - 6:
                score -= 10
                issues.append(f"Copyright {newest}")

        if re.search(r"book|schedule|appointment|request a quote|get a quote", html):
            score += 10
        else:
            issues.append("No online booking or quote form")
        if 'href="tel:' in html:
            score += 5
        else:
            issues.append("No click-to-call link")
        if "<title>" in html:
            score += 5
        if result.elapsed_ms > 4000:
            score -= 10
            issues.append(f"Slow load ({result.elapsed_ms / 1000:.1f}s)")
        else:
            score += 5

        score = max(0, min(100, score))
        if score < 55:
            category = PresenceCategory.OUTDATED.value
        elif score < 80:
            category = PresenceCategory.DECENT.value
        else:
            category = PresenceCategory.GOOD.value
        lead.presence = Presence(has_site=True, url=url, score=score,
                                 category=category, issues=issues)


# ---------------------------------------------------------------------------
# Enrichment — still a stub (broker choice is a business decision)
# ---------------------------------------------------------------------------
class BrokerEnrichment(EnrichmentProvider):
    """Owner name / email from a data broker (Apollo, Data Axle) + services
    parsed from their GBP/Yelp/existing site. Not wired: pick a broker first —
    it's a $/record commercial decision, not a technical one."""

    def enrich(self, lead: Lead) -> None:
        raise ProviderNotReady(
            "Enrichment not configured: choose a data broker (Apollo/Data Axle) "
            "and implement BrokerEnrichment.enrich. Interim: run with mock "
            "enrichment or populate contacts manually.")


# ---------------------------------------------------------------------------
# Content — Anthropic Messages API, grounded + post-filtered
# ---------------------------------------------------------------------------
class LLMContentWriter(ContentWriter):
    ENDPOINT = "https://api.anthropic.com/v1/messages"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient(timeout=60)

    def write_copy(self, lead: Lead) -> dict:
        if not settings.anthropic_key:
            raise ProviderNotReady(
                "Content writer not configured: set ANTHROPIC_API_KEY.")

        facts = {
            "business_name": lead.business.name,
            "category": lead.business.category.replace("_", " "),
            "city": lead.business.city, "state": lead.business.state,
            "owner_first_name": (lead.contacts.owner_name.split()[0]
                                 if lead.contacts.owner_name else ""),
            "services": lead.enrichment.services,
            "rating": lead.business.rating,
            "review_count": lead.business.review_count,
            "review_summary": lead.enrichment.review_summary,
        }
        prompt = (
            "Write website copy for a local small business. Use ONLY the facts "
            "below — do not invent services, awards, years in business, or "
            "certifications. Return ONLY a JSON object with keys: headline, "
            "subhead, about, services (list of {name, blurb} using EXACTLY the "
            "service names given), cta, review.\n\nFACTS:\n"
            + json.dumps(facts, indent=2)
        )
        status, text = self.http.request(
            "POST", self.ENDPOINT,
            headers={"x-api-key": settings.anthropic_key,
                     "anthropic-version": "2023-06-01"},
            json_body={"model": settings.llm_model, "max_tokens": 1200,
                       "messages": [{"role": "user", "content": prompt}]})
        if status != 200:
            raise RuntimeError(f"Anthropic API error {status}: {text[:300]}")

        raw = "".join(b.get("text", "") for b in json.loads(text).get("content", []))
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        copy = json.loads(raw)

        # Enforce grounding in CODE, not just the prompt: drop any service the
        # model invented, and backfill any it omitted.
        allowed = list(lead.enrichment.services)
        if allowed:
            kept = [s for s in copy.get("services", []) if s.get("name") in allowed]
            have = {s["name"] for s in kept}
            kept += [{"name": s, "blurb": f"Professional {s.lower()} with upfront pricing."}
                     for s in allowed if s not in have]
            copy["services"] = kept
        for key, fallback in [("headline", f"{lead.business.city}'s Trusted Team"),
                              ("subhead", ""), ("about", ""), ("cta", "Get a Free Quote"),
                              ("review", lead.enrichment.review_summary)]:
            copy.setdefault(key, fallback)
        return copy


# ---------------------------------------------------------------------------
# Email — any SMTP relay (Postmark/SES/SendGrid all speak SMTP)
# ---------------------------------------------------------------------------
class SMTPEmail(EmailProvider):
    def __init__(self, smtp_factory=None) -> None:
        # Injectable factory: tests pass a fake; default builds smtplib.SMTP.
        self._factory = smtp_factory

    def _make_smtp(self):
        if self._factory:
            return self._factory(settings.smtp_host, settings.smtp_port)
        import smtplib
        return smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)

    def send(self, lead: Lead, subject: str, body: str) -> str:
        missing = [n for n, v in [("APOP_SMTP_HOST", settings.smtp_host),
                                  ("APOP_FROM_EMAIL", settings.from_email),
                                  ("APOP_POSTAL_ADDRESS", settings.postal_address)]
                   if not v]
        if missing:
            raise ProviderNotReady(
                f"Email not configured: set {', '.join(missing)}. A postal "
                f"address is a CAN-SPAM requirement, not a nicety.")
        if not lead.contacts.emails:
            raise ValueError(f"lead {lead.id} has no email address")

        from email.message import EmailMessage
        msg = EmailMessage()
        msg["From"] = settings.from_email
        msg["To"] = lead.contacts.emails[0]
        msg["Subject"] = subject
        msg.set_content(body)

        smtp = self._make_smtp()
        try:
            if settings.smtp_user:
                smtp.starttls()
                smtp.login(settings.smtp_user, settings.smtp_pass)
            smtp.send_message(msg)
        finally:
            try:
                smtp.quit()
            except Exception:
                pass

        # Archive a copy for the audit trail, same as mock mode (numbered per
        # touch so follow-ups never overwrite the intro).
        settings.ensure_dirs()
        n = sum(1 for a in lead.outreach if a.channel == "email") + 1
        path = settings.outbox_dir / f"{lead.id}_email_{n}.txt"
        path.write_text(f"To: {msg['To']}\nSubject: {subject}\n\n{body}\n",
                        encoding="utf-8")
        lead.outreach.append(OutreachAttempt(
            channel="email", at=_now(), disposition="sent", artifact=str(path)))
        return str(path)


# ---------------------------------------------------------------------------
# Voice — Vapi outbound call, DOUBLE-gated
# ---------------------------------------------------------------------------
class VapiVoice(VoiceProvider):
    """Outbound AI call via Vapi. Requires BOTH a key and APOP_VOICE_ENABLED=1:
    the second gate is a deliberate speed bump — before flipping it, confirm
    DNC scrubbing, calling-hours, AI disclosure, and consent posture
    (docs/DESIGN.md §7). The assistant prompt hard-codes disclosure-first."""

    ENDPOINT = "https://api.vapi.ai/call"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient(timeout=30)

    def call(self, lead: Lead, script: dict) -> dict:
        if not settings.vapi_key:
            raise ProviderNotReady("Voice not configured: set VAPI_API_KEY.")
        if not settings.voice_enabled:
            raise ProviderNotReady(
                "Voice is gated: set APOP_VOICE_ENABLED=1 only after reviewing "
                "docs/DESIGN.md §7 (TCPA/DNC/disclosure). This gate is "
                "intentional — do not remove it.")
        if not lead.contacts.phones:
            raise ValueError(f"lead {lead.id} has no phone number")

        disclosure = AI_DISCLOSURE_LINE.format(company=settings.brand)
        system_prompt = (
            f"You are a polite sales assistant. Your FIRST sentence must be "
            f"exactly: \"{disclosure}\" Then: {script['opener']} "
            f"Never claim to be human. If the person opts out, apologize, end "
            f"the call, and flag DNC. No pressure tactics, no false claims.")
        status, text = self.http.request(
            "POST", self.ENDPOINT,
            headers={"Authorization": f"Bearer {settings.vapi_key}"},
            json_body={
                "customer": {"number": lead.contacts.phones[0]},
                "assistant": {
                    "firstMessage": disclosure,
                    "model": {"provider": "anthropic",
                              "model": settings.llm_model,
                              "messages": [{"role": "system",
                                            "content": system_prompt}]},
                },
            })
        if status not in (200, 201):
            raise RuntimeError(f"Vapi API error {status}: {text[:300]}")
        call_id = json.loads(text).get("id", "")
        lead.compliance.ai_disclosure_given = True
        lead.outreach.append(OutreachAttempt(
            channel="voice", at=_now(), disposition="initiated",
            artifact=f"vapi:{call_id}"))
        # Real disposition arrives via Vapi's end-of-call webhook → update the
        # lead there. "initiated" keeps the lead CONTACTED until then.
        return {"disposition": "no_answer", "transcript": "", "artifact": f"vapi:{call_id}"}


# ---------------------------------------------------------------------------
# Payment — Stripe Checkout (link sent to the lead; webhook confirms)
# ---------------------------------------------------------------------------
class StripePayment(PaymentProvider):
    ENDPOINT = "https://api.stripe.com/v1/checkout/sessions"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient(timeout=30)

    def charge(self, lead: Lead, amount: int) -> bool:
        if not settings.stripe_key:
            raise ProviderNotReady("Payment not configured: set STRIPE_API_KEY.")

        form = {
            "mode": "payment",
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": str(amount * 100),
            "line_items[0][price_data][product_data][name]":
                f"Website for {lead.business.name}",
            "line_items[0][quantity]": "1",
            "success_url": f"{settings.preview_host}/paid/{lead.id}",
            "cancel_url": lead.demo.preview_url or settings.preview_host,
            "client_reference_id": lead.id,
        }
        status, text = self.http.request(
            "POST", self.ENDPOINT,
            headers={"Authorization": f"Bearer {settings.stripe_key}"},
            form_body=form)
        if status != 200:
            raise RuntimeError(f"Stripe API error {status}: {text[:300]}")
        session = json.loads(text)
        lead.billing.payment_link = session.get("url", "")
        lead.billing.method = "stripe_checkout"
        lead.note(f"stripe checkout link created: {lead.billing.payment_link}")
        # Payment is asynchronous: send the link, confirm via the
        # checkout.session.completed webhook. Never assume paid here.
        return False
