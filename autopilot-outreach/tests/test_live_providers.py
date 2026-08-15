"""Offline tests for the LIVE providers.

No network, no keys: each provider takes an injectable transport, so these
exercise the real request-building and response-parsing code against canned
API responses. This is what lets you debug live integrations before spending
a cent on real API calls.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autopilot.config import settings  # noqa: E402
from autopilot.models import Lead, PresenceCategory  # noqa: E402
from autopilot.providers.live import (  # noqa: E402
    FetchResult,
    GooglePlacesDiscovery,
    HeadlessPresence,
    LLMContentWriter,
    ProviderNotReady,
    SMTPEmail,
    StripePayment,
    VapiVoice,
)


class FakeHttp:
    """Matches HttpClient.request(); returns canned (status, body) tuples."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers=None, json_body=None, form_body=None):
        self.calls.append({"method": method, "url": url, "headers": headers or {},
                           "json": json_body, "form": form_body})
        return self.responses.pop(0)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        settings.data_dir = d
        settings.db_path = d / "leads.db"
        settings.demos_dir = d / "demos"
        settings.outbox_dir = d / "outbox"
        settings.ensure_dirs()
        # Snapshot config we mutate, restore in tearDown.
        self._saved = {k: getattr(settings, k) for k in
                       ("google_places_key", "anthropic_key", "stripe_key",
                        "vapi_key", "voice_enabled", "smtp_host", "smtp_user",
                        "smtp_pass", "from_email", "postal_address")}

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(settings, k, v)
        self.tmp.cleanup()


# ---------------------------------------------------------------------------
class TestGooglePlaces(Base):
    PAGE1 = (200, json.dumps({
        "places": [
            {"id": "ChIJabc123", "displayName": {"text": "Joe's Landscaping"},
             "formattedAddress": "1 Main St, Austin, TX",
             "nationalPhoneNumber": "(512) 555-0101",
             "websiteUri": "http://joes.example",
             "rating": 4.6, "userRatingCount": 88,
             "location": {"latitude": 30.1, "longitude": -97.7}},
            {"id": "ChIJdef456", "displayName": {"text": "Green Thumb Co"},
             "formattedAddress": "2 Oak Ave, Austin, TX",
             "rating": 4.1, "userRatingCount": 12},
        ],
        "nextPageToken": "tok123",
    }))
    PAGE2 = (200, json.dumps({
        "places": [
            {"id": "ChIJghi789", "displayName": {"text": "Lawn Bros"},
             "formattedAddress": "3 Elm Rd, Austin, TX"},
        ],
    }))

    def test_requires_key(self):
        settings.google_places_key = ""
        with self.assertRaises(ProviderNotReady):
            GooglePlacesDiscovery(http=FakeHttp([])).search("Austin", "landscaping", 5)

    def test_maps_and_paginates(self):
        settings.google_places_key = "test-key"
        fake = FakeHttp([self.PAGE1, self.PAGE2])
        leads = GooglePlacesDiscovery(http=fake).search("Austin", "landscaping", 3)

        self.assertEqual(len(leads), 3)
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(fake.calls[1]["json"]["pageToken"], "tok123")
        self.assertEqual(fake.calls[0]["headers"]["X-Goog-Api-Key"], "test-key")

        joe = leads[0]
        self.assertEqual(joe.business.name, "Joe's Landscaping")
        self.assertEqual(joe.presence.url, "http://joes.example")
        self.assertTrue(joe.presence.has_site)
        self.assertTrue(joe.id.startswith("gp-"))
        # No websiteUri → has_site False, ready for the no_site path.
        self.assertFalse(leads[1].presence.has_site)

    def test_api_error_raises_with_body(self):
        settings.google_places_key = "test-key"
        fake = FakeHttp([(403, '{"error": {"message": "API key invalid"}}')])
        with self.assertRaises(RuntimeError) as ctx:
            GooglePlacesDiscovery(http=fake).search("Austin", "landscaping", 1)
        self.assertIn("403", str(ctx.exception))


# ---------------------------------------------------------------------------
MODERN_HTML = """<html><head><title>Pro Lawn</title>
<meta name="viewport" content="width=device-width"></head>
<body><a href="tel:5125550101">Call</a>
<p>Book an appointment or request a quote today.</p>
<footer>&copy; 2026 Pro Lawn</footer></body></html>"""

ANCIENT_HTML = """<html><head><title>Welcome</title></head>
<body><table><tr><td>Best prices in town!!</td></tr></table>
<p>Copyright 2009 Joe</p></body></html>"""


class TestHeadlessPresence(Base):
    def _lead(self, url):
        lead = Lead(id="p1")
        lead.presence.url = url
        return lead

    def test_no_url_is_no_site(self):
        lead = self._lead("")
        HeadlessPresence(fetch=lambda u: None).analyze(lead)
        self.assertEqual(lead.presence.category, PresenceCategory.NO_SITE.value)

    def test_unreachable_is_no_site(self):
        def boom(url):
            raise OSError("connection refused")
        lead = self._lead("http://dead.example")
        HeadlessPresence(fetch=boom).analyze(lead)
        self.assertEqual(lead.presence.category, PresenceCategory.NO_SITE.value)
        self.assertIn("unreachable", lead.presence.issues[0].lower())

    def test_modern_site_scores_high(self):
        fetch = lambda u: FetchResult(200, "https://prolawn.example", MODERN_HTML, 800)
        lead = self._lead("https://prolawn.example")
        HeadlessPresence(fetch=fetch).analyze(lead)
        self.assertIn(lead.presence.category,
                      {PresenceCategory.DECENT.value, PresenceCategory.GOOD.value})
        self.assertGreaterEqual(lead.presence.score, 55)

    def test_ancient_site_scores_low(self):
        fetch = lambda u: FetchResult(200, "http://joes.example", ANCIENT_HTML, 5200)
        lead = self._lead("http://joes.example")
        HeadlessPresence(fetch=fetch).analyze(lead)
        self.assertEqual(lead.presence.category, PresenceCategory.OUTDATED.value)
        issues = " ".join(lead.presence.issues)
        self.assertIn("HTTPS", issues)
        self.assertIn("mobile", issues)
        self.assertIn("2009", issues)
        self.assertIn("Slow", issues)


# ---------------------------------------------------------------------------
class TestLLMContentWriter(Base):
    def _lead(self):
        lead = Lead(id="c1")
        lead.business.name = "Joe's Landscaping"
        lead.business.city = "Austin"
        lead.enrichment.services = ["Lawn Mowing", "Mulching"]
        return lead

    def _api_response(self, payload: dict):
        return (200, json.dumps({
            "content": [{"type": "text", "text": json.dumps(payload)}]}))

    def test_requires_key(self):
        settings.anthropic_key = ""
        with self.assertRaises(ProviderNotReady):
            LLMContentWriter(http=FakeHttp([])).write_copy(self._lead())

    def test_parses_and_filters_ungrounded_services(self):
        settings.anthropic_key = "test-key"
        fake = FakeHttp([self._api_response({
            "headline": "Austin's Greenest Lawns",
            "subhead": "s", "about": "a", "cta": "Go", "review": "r",
            "services": [
                {"name": "Lawn Mowing", "blurb": "great"},
                {"name": "Snow Removal", "blurb": "HALLUCINATED"},  # not enriched
            ],
        })])
        copy = LLMContentWriter(http=fake).write_copy(self._lead())
        names = [s["name"] for s in copy["services"]]
        self.assertNotIn("Snow Removal", names, "ungrounded service must be dropped")
        self.assertIn("Lawn Mowing", names)
        self.assertIn("Mulching", names, "omitted real service must be backfilled")
        # The request itself must carry the grounding instruction + facts.
        prompt = fake.calls[0]["json"]["messages"][0]["content"]
        self.assertIn("ONLY the facts", prompt)
        self.assertIn("Joe's Landscaping", prompt)

    def test_strips_code_fences(self):
        settings.anthropic_key = "test-key"
        inner = json.dumps({"headline": "H", "services": []})
        fake = FakeHttp([(200, json.dumps({
            "content": [{"type": "text", "text": f"```json\n{inner}\n```"}]}))])
        copy = LLMContentWriter(http=fake).write_copy(self._lead())
        self.assertEqual(copy["headline"], "H")


# ---------------------------------------------------------------------------
class FakeSMTP:
    def __init__(self):
        self.sent = []
        self.tls = False
        self.login_args = None

    def starttls(self):
        self.tls = True

    def login(self, user, pw):
        self.login_args = (user, pw)

    def send_message(self, msg):
        self.sent.append(msg)

    def quit(self):
        pass


class TestSMTPEmail(Base):
    def test_requires_config(self):
        settings.smtp_host = ""
        lead = Lead(id="e1")
        lead.contacts.emails = ["x@example.com"]
        with self.assertRaises(ProviderNotReady) as ctx:
            SMTPEmail().send(lead, "s", "b")
        self.assertIn("CAN-SPAM", str(ctx.exception))

    def test_sends_and_archives(self):
        settings.smtp_host = "smtp.test"
        settings.smtp_user = "u"
        settings.smtp_pass = "p"
        settings.from_email = "hello@autopilotweb.example"
        settings.postal_address = "1 Demo St, Austin TX"
        smtp = FakeSMTP()
        lead = Lead(id="e2")
        lead.contacts.emails = ["owner@biz.example"]

        provider = SMTPEmail(smtp_factory=lambda h, p: smtp)
        path = provider.send(lead, "Subject!", "Body text")

        self.assertEqual(len(smtp.sent), 1)
        self.assertTrue(smtp.tls)
        self.assertEqual(smtp.sent[0]["To"], "owner@biz.example")
        self.assertTrue(Path(path).exists())
        self.assertEqual(lead.outreach[-1].channel, "email")


# ---------------------------------------------------------------------------
class TestVapiVoice(Base):
    def _lead(self):
        lead = Lead(id="v1")
        lead.business.name = "Joe's"
        lead.contacts.phones = ["+15125550101"]
        return lead

    def test_double_gate(self):
        settings.vapi_key = ""
        with self.assertRaises(ProviderNotReady):
            VapiVoice(http=FakeHttp([])).call(self._lead(), {"opener": "hi"})
        settings.vapi_key = "key"
        settings.voice_enabled = False
        with self.assertRaises(ProviderNotReady) as ctx:
            VapiVoice(http=FakeHttp([])).call(self._lead(), {"opener": "hi"})
        self.assertIn("APOP_VOICE_ENABLED", str(ctx.exception))

    def test_call_includes_disclosure_first(self):
        settings.vapi_key = "key"
        settings.voice_enabled = True
        fake = FakeHttp([(201, json.dumps({"id": "call_123"}))])
        lead = self._lead()
        result = VapiVoice(http=fake).call(lead, {"opener": "I built you a site."})

        body = fake.calls[0]["json"]
        self.assertIn("automated AI assistant", body["assistant"]["firstMessage"])
        self.assertEqual(body["customer"]["number"], "+15125550101")
        self.assertTrue(lead.compliance.ai_disclosure_given)
        self.assertEqual(result["artifact"], "vapi:call_123")


# ---------------------------------------------------------------------------
class TestStripePayment(Base):
    def test_creates_checkout_link_and_stays_pending(self):
        settings.stripe_key = "sk_test_123"
        fake = FakeHttp([(200, json.dumps(
            {"id": "cs_1", "url": "https://checkout.stripe.com/pay/cs_1"}))])
        lead = Lead(id="pay1")
        lead.business.name = "Joe's"

        paid = StripePayment(http=fake).charge(lead, 1000)

        self.assertFalse(paid, "payment must stay pending until the webhook")
        self.assertEqual(lead.billing.payment_link,
                         "https://checkout.stripe.com/pay/cs_1")
        form = fake.calls[0]["form"]
        self.assertEqual(form["line_items[0][price_data][unit_amount]"], "100000")
        self.assertEqual(form["client_reference_id"], "pay1")


if __name__ == "__main__":
    unittest.main()
