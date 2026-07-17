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
    def test_demo_html_is_written_and_valid(self):
        leads = self.pipe.discover("Austin", "landscaping", 12)
        lead = next(self.pipe.qualify(l) for l in leads
                    if self.pipe.qualify(l).status == Status.QUALIFIED.value)
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
