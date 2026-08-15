# Autopilot Outreach

An autonomous system that discovers local small businesses, evaluates their web
presence, builds or redesigns a website for them on spec, and reaches out
(including via AI voice) to sell it — "I already built you a site, want to see
it free? Keep it for $1,000."

There are two layers in this folder:

- **[`docs/DESIGN.md`](docs/DESIGN.md)** — the full architecture brainstorm:
  subsystems, tooling, scale, unit economics, and the legal/compliance realities
  (TCPA/DNC/scraping) that shape everything.
- **A working MVP** you can run *right now, offline, with zero API keys* — it
  runs the entire funnel in mock mode and generates **real, viewable demo
  websites**.

---

## Quickstart (no setup, no dependencies, no keys)

Everything runs on the Python 3.9+ standard library.

```bash
cd autopilot-outreach

python3 run.py demo          # run a full mock campaign end-to-end
python3 run.py dashboard     # then open http://localhost:8000
```

That's it. `demo` will:
1. **Discover** 12 fake landscaping businesses in Austin
2. **Score** each one's web presence (`no_site` / `outdated` / `decent` / `good`)
3. **Reject** the ones with good sites; **qualify + enrich** the rest
4. **Generate a real website** for each target → `data/demos/<id>/index.html`
5. **Run the multi-day outreach cadence** through compliance gates (DNC scrub,
   calling-hours, AI disclosure): intro email (day 0) → AI call (day 1) →
   follow-up (day 3) → honest breakup email (day 7), simulated in one run.
   Every touch is A/B-tested between two hooks; artifacts land in `data/outbox/`.
6. **Collect mock payment** from interested leads and report the funnel,
   revenue, and per-variant A/B performance

Then the **dashboard** shows the funnel, A/B stats, the human **review queue**
(QA-failed demos) and **close queue** (interested, payment pending), per-lead
audit trails, call transcripts, and the generated sites themselves.

### Other commands

```bash
python3 run.py demo --city Phoenix --category auto_repair --limit 15
python3 run.py --seed 7 demo        # different (still deterministic) dataset
python3 run.py tick --day 3         # manually advance the cadence one day
python3 run.py stats                # A/B variant performance table
python3 run.py doctor               # what's configured / what each key unlocks
python3 run.py list                 # all leads + statuses
python3 run.py show <lead_id>       # one lead's full audit trail
python3 run.py summary              # funnel counts + revenue
python3 run.py reset                # wipe local db + generated artifacts

make test                           # run the test suite (30 tests, stdlib unittest)
```

Verticals available in mock mode: `landscaping`, `auto_repair`, `plumbing`.

---

## What it looks like

Generated demo site (real HTML, themed per vertical, grounded in the lead's
actual data — owner name, city, services, rating):

![demo site](docs/img/demo_site.png)

Funnel dashboard:

![dashboard](docs/img/dashboard.png)

---

## How it's built (and how to make it real)

```
run.py                      # single CLI entrypoint
src/autopilot/
  config.py                 # env-driven settings; APOP_MODE=mock|live
  models.py                 # Lead dataclass + status state machine
  store.py                  # sqlite lead store
  compliance.py             # DNC / calling-hours / AI-disclosure gates
  pipeline.py               # the orchestrator (discover→qualify→build→reach→convert)
  providers/
    base.py                 # provider interfaces + mock/live factory
    mock.py                 # deterministic offline fakes (what runs by default)
    live.py                 # documented stubs for the real APIs
  sitegen/renderer.py       # generates the demo website HTML
  dashboard/server.py       # stdlib http dashboard
tests/test_pipeline.py      # end-to-end + unit tests
```

```
  cadence.py                # multi-day touch plan, A/B variants, email/voice copy
  providers/http.py         # stdlib HTTP client (proxy/CA aware) for live mode
tests/test_live_providers.py  # live providers tested offline via fake transports
```

**The key design choice:** every external dependency (Google Places, presence
analysis, LLM copywriting, email, voice, payment) sits behind an interface in
`providers/base.py`. Mock implementations run offline. **Switching a stage from
mock to live never touches pipeline code.**

### Live-provider status (all stdlib — even live mode needs no pip installs)

| Stage | Implementation | Needs | Status |
|---|---|---|---|
| Discovery | Google Places API (New) `searchText` + pagination | `GOOGLE_PLACES_API_KEY` | ✅ implemented |
| Presence | Heuristic site audit (HTTPS/viewport/copyright/booking/speed) | nothing | ✅ implemented |
| Content | Anthropic Messages API, grounded + code-enforced service filter | `ANTHROPIC_API_KEY` | ✅ implemented |
| Email | Any SMTP relay, CAN-SPAM footer enforced | `APOP_SMTP_*`, `APOP_FROM_EMAIL`, `APOP_POSTAL_ADDRESS` | ✅ implemented |
| Payment | Stripe Checkout session → link; webhook confirms | `STRIPE_API_KEY` | ✅ implemented (webhook receiver TODO) |
| Voice | Vapi outbound call, disclosure-first prompt | `VAPI_API_KEY` **and** `APOP_VOICE_ENABLED=1` | ✅ implemented, **double-gated** |
| Enrichment | Data broker | pick a broker (commercial decision) | ⛔ stub |

Every live provider takes an injectable transport, so its request-building and
response-parsing logic is fully unit-tested offline (`tests/test_live_providers.py`)
— you can debug live integrations before spending a cent on real API calls.
Run `python3 run.py doctor` to see exactly what's configured and what each
missing key unlocks.

**Voice is deliberately double-gated**: a key alone won't place calls — you must
also set `APOP_VOICE_ENABLED=1`, which exists as a speed bump to re-read
`docs/DESIGN.md` §7 (TCPA/DNC/disclosure/consent) first. The gate is
intentional; wire voice last, after the email funnel is proven.
