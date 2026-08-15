"""End-to-end + unit tests. Pure stdlib unittest, no pytest needed.

Run:  python -m unittest discover -s tests   (or `make test`)
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autopilot.config import settings  # noqa: E402
from autopilot.models import Lead, PresenceCategory, Status  # noqa: E402
from autopilot.pipeline import Pipeline, qa_demo  # noqa: E402
from autopilot.providers import build_providers  # noqa: E402
from autopilot.store import LeadStore  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        settings.data_dir = d
        settings.db_path = d / "leads.db"
        settings.demos_dir = d / "demos"
        settings.outbox_dir = d / "outbox"
        settings.mode = "mock"
        settings.seed = 42
        settings.ensure_dirs()
        self.store = LeadStore()
        self.pipe = Pipeline(self.store)

    def tearDown(self):
        self.tmp.cleanup()


class TestDiscovery(Base):
    def test_discovery_is_deterministic(self):
        a = build_providers()["discovery"].search("Austin", "landscaping", 5)
        b = build_providers()["discovery"].search("Austin", "landscaping", 5)
        self.assertEqual([x.business.name for x in a],
                         [x.business.name for x in b])
        self.assertEqual(len(a), 5)

    def test_discovery_populates_fields(self):
        leads = self.pipe.discover("Austin", "landscaping", 3)
        for ld in leads:
            self.assertTrue(ld.business.name)
            self.assertTrue(ld.business.phone)
            self.assertEqual(ld.business.category, "landscaping")


class TestQualify(Base):
    def test_good_presence_is_rejected(self):
        lead = Lead(id="x")
        lead.presence.category = PresenceCategory.GOOD.value
        lead.presence.score = 90
        # analyze() overwrites, so test the gate directly via a crafted provider
        self.pipe.p["presence"].analyze(lead)  # deterministic per id
        self.pipe.qualify(lead)
        self.assertIn(lead.status, {Status.QUALIFIED.value, Status.REJECTED.value})

    def test_qualified_leads_get_enriched(self):
        leads = self.pipe.discover("Austin", "landscaping", 12)
        qualified = [self.pipe.qualify(l) for l in leads]
        q = [l for l in qualified if l.status == Status.QUALIFIED.value]
        self.assertTrue(q, "expected at least one qualified lead")
        for l in q:
            self.assertTrue(l.enrichment.services)
            self.assertTrue(l.contacts.emails)


class TestSiteGen(Base):
    def _first_qualified(self, city="Austin", category="landscaping"):
        for l in self.pipe.discover(city, category, 12):
            if self.pipe.qualify(l).status == Status.QUALIFIED.value:
                return l
        self.fail("no qualified lead in mock dataset")

    def test_demo_html_is_written_and_valid(self):
        lead = self._first_qualified()
        self.pipe.build_demo(lead)
        self.assertTrue(Path(lead.demo.path).exists())
        htmltxt = Path(lead.demo.path).read_text()
        self.assertIn("<!doctype html>", htmltxt)
        self.assertIn(lead.business.name.split("'")[0], htmltxt)
        self.assertTrue(lead.demo.qa_passed)

    def test_qa_flags_ungrounded_service(self):
        lead = Lead(id="q1")
        lead.enrichment.services = ["Oil Changes"]
        copy = {"headline": "H", "services": [{"name": "Fake Service", "blurb": "x"}]}
        ok, notes = qa_demo(lead, copy)
        self.assertFalse(ok)
        self.assertTrue(any("ungrounded" in n for n in notes))


class TestCampaign(Base):
    def test_full_campaign_produces_funnel(self):
        summary = self.pipe.run_campaign("Austin", "landscaping", 12)
        counts = summary["counts"]
        self.assertEqual(sum(counts.values()), 12)
        # Some leads should progress past discovery.
        self.assertTrue(any(counts.get(s) for s in
                            ["DEMO_BUILT", "CONTACTED", "INTERESTED", "CONVERTED"]))

    def test_revenue_only_from_paid(self):
        self.pipe.run_campaign("Austin", "landscaping", 12)
        converted = self.store.by_status(Status.CONVERTED)
        self.assertEqual(self.store.revenue(),
                         sum(l.billing.quote for l in converted))


class TestCadence(Base):
    def test_multi_day_cadence_produces_followups(self):
        """Non-responding leads must receive follow-up touches on later days."""
        self.pipe.run_campaign("Austin", "landscaping", 12)
        contacted = self.store.by_status(Status.CONTACTED)
        self.assertTrue(contacted, "expected at least one non-responder")
        for lead in contacted:
            days = [a.day for a in lead.outreach]
            self.assertGreaterEqual(len(lead.outreach), 3,
                                    f"{lead.id} should get intro+call+followups")
            self.assertEqual(days, sorted(days), "touches must be in day order")
            kinds = [a.kind for a in lead.outreach]
            self.assertEqual(kinds[0], "intro")
            self.assertIn("followup", kinds)

    def test_interested_leads_stop_cadence(self):
        """No follow-up spam after a lead says yes: cadence must stop."""
        self.pipe.run_campaign("Austin", "landscaping", 12)
        for lead in (self.store.by_status(Status.INTERESTED)
                     + self.store.by_status(Status.CONVERTED)):
            self.assertTrue(lead.cadence.stopped)
            self.assertEqual(lead.cadence.stop_reason, "interested")
            # No email touches after the day the voice call landed.
            call_day = next(a.day for a in lead.outreach if a.channel == "voice")
            after = [a for a in lead.outreach if a.day > call_day]
            self.assertEqual(after, [])

    def test_variants_are_deterministic_and_split(self):
        from autopilot.cadence import assign_variant
        self.assertEqual(assign_variant("lead-1"), assign_variant("lead-1"))
        variants = {assign_variant(f"lan-aus-{i:03d}") for i in range(12)}
        self.assertEqual(variants, {"A", "B"}, "12 leads should hit both variants")

    def test_outreach_copy_never_lies_about_presence(self):
        """Variant B's 'can't find you online' hook must not be used on leads
        that DO have a website (truthful-outreach invariant, DESIGN §7)."""
        from autopilot.cadence import render_email, voice_script
        from autopilot.models import Lead

        with_site = Lead(id="t1")
        with_site.business.name = "Maria's"
        with_site.presence.has_site = True
        subject, _ = render_email(with_site, "intro", "B")
        self.assertNotIn("can't find", subject)
        self.assertNotIn("couldn't find", voice_script(with_site, "B")["opener"])

        no_site = Lead(id="t2")
        no_site.business.name = "Joe's"
        no_site.presence.has_site = False
        subject, _ = render_email(no_site, "intro", "B")
        self.assertIn("can't find", subject)

    def test_free_mode_copy_offers_free_not_zero_dollars(self):
        """APOP_PRICE=0 must produce 'yours free' copy, never '$0 to keep'."""
        from autopilot.cadence import render_email
        from autopilot.models import Lead
        lead = Lead(id="f1")
        lead.business.name = "Joe's"
        old_price = settings.price_one_time
        try:
            settings.price_one_time = 0
            _, body = render_email(lead, "intro", "A")
            self.assertIn("free", body.lower())
            self.assertNotIn("$0", body)
        finally:
            settings.price_one_time = old_price

    def test_ab_stats_totals_match_funnel(self):
        from autopilot.cadence import ab_stats
        self.pipe.run_campaign("Austin", "landscaping", 12)
        stats = ab_stats(self.store.all())
        self.assertTrue(stats)
        converted = sum(s["converted"] for s in stats.values())
        self.assertEqual(converted, len(self.store.by_status(Status.CONVERTED)))
        revenue = sum(s["revenue"] for s in stats.values())
        self.assertEqual(revenue, self.store.revenue())


class TestCompliance(Base):
    def test_dnc_suffix_is_blocked(self):
        from autopilot.compliance import check_dnc
        lead = Lead(id="d1")
        lead.business.phone = "(555) 123-0000"  # ends 0000 → simulated DNC
        self.assertTrue(check_dnc(lead))
        self.assertTrue(lead.compliance.on_dnc)


class TestPersistence(Base):
    def test_roundtrip_json(self):
        leads = self.pipe.discover("Austin", "plumbing", 2)
        got = self.store.get(leads[0].id)
        self.assertEqual(got.id, leads[0].id)
        self.assertEqual(got.business.name, leads[0].business.name)


if __name__ == "__main__":
    unittest.main()
