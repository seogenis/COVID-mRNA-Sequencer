# Autopilot Outreach — Architecture & Design Brainstorm

> Design document only. Nothing here is built yet. The goal is to think through
> how the whole thing fits together, what tools do the heavy lifting, how it
> scales, what it costs, and where the real risks are.

---

## 1. What we're actually building

A pipeline that runs mostly unattended and turns a geographic + vertical query
("landscapers in Austin", "auto repair in Phoenix") into paying website
customers. Broken into a lead's journey:

```
 DISCOVER ──► ENRICH ──► QUALIFY ──► GENERATE SITE ──► OUTREACH ──► CONVERT ──► FULFILL
   (find)     (contacts) (score)      (demo build)    (call/SMS)    ($)       (deploy)
```

The clever part of the pitch is that **the product is already built before you
ask**. There's no "let me put together a proposal." The lead clicks a link,
sees their own business rendered beautifully, and the only decision is keep-it-
or-not. That reverses the usual agency sales friction. The whole system is
optimized around making that "already built it" demo cheap enough to produce at
volume that you can afford to build for people who never convert.

### Core design tension

Everything hinges on **cost-per-demo vs. conversion rate**. If a demo costs
\$0.50 to produce and 2% of cold-called leads convert at \$1,000, the unit
economics are excellent. If a demo costs \$8 and conversion is 0.3%, you're
underwater. So the architecture is built to (a) drive demo cost toward zero via
templating + LLM fill, and (b) qualify hard *before* spending on a demo or a
call.

---

## 2. Subsystem 1 — Discovery & Enrichment

### 2.1 Finding businesses

**Primary source: Google Places API (New).** This is the legitimate, ToS-
compliant path versus scraping Maps HTML.

- `searchNearby` / `searchText` — query by location + type (`landscaping`,
  `car_repair`, `plumber`, etc.) within a radius or bounding box.
- `Place Details` — pulls name, address, phone, website URL, rating, review
  count, business hours, price level.
- Pagination gives ~60 results per query cell, so you tile a metro area into a
  grid of overlapping search circles to get full coverage.

**Why not scrape Google Maps directly?** It violates Google's ToS, breaks
constantly (they obfuscate the DOM), and creates CFAA exposure. The Places API
costs money per call but is stable and defensible. Budget it as a real line
item (see §8). Third-party aggregators (Outscraper, SerpApi, Apify Google Maps
scrapers) exist and are cheaper per-record, but you're outsourcing the ToS
risk, not eliminating it — treat them as an optimization, not the foundation.

**Secondary/enrichment sources:**
- **Yelp Fusion API** — cross-reference, fill gaps, richer category taxonomy.
- **Data brokers** (Data Axle, ZoomInfo, Apollo, Clearbit/HubSpot Breeze) —
  owner name, email, company size, sometimes mobile. Expensive but high-value
  for personalization.
- **Secretary of State business registries** — owner-of-record, entity type,
  registration date (a business registered 3 months ago is a hot lead — no site
  yet, actively spending to get going).
- **State licensing boards** (contractors, HVAC, electricians) — verified
  active businesses with license numbers.

### 2.2 Detecting web presence

For each lead, classify into: **no site / bad site / good site.**

- **No website field** in Places → strong "no site" signal (but verify — many
  use only a Facebook/Instagram page, which counts as "no real site" for us).
- If a URL exists, fetch it headless (Playwright — already available in this
  environment) and evaluate:
  - HTTP status / does it even load / is it parked or a GoDaddy placeholder
  - **Mobile responsiveness** (single biggest tell of an outdated site)
  - Page-speed / Core Web Vitals (Lighthouse programmatically)
  - Last-modified signals, copyright year, presence of SSL
  - Whether it has the things a service business needs: click-to-call,
    booking/quote form, service area, reviews
  - A screenshot → feed to a vision LLM for a "does this look like it's from
    2009?" score
- Output a **web-presence score (0–100)** and a categorical `no_site /
  outdated / decent / good`. Only `no_site` and `outdated` are targets.

### 2.3 Enrichment for personalization

The voice/SMS pitch lands far better with: owner first name, a specific
compliment or critique ("noticed your site isn't mobile-friendly"), the
business's actual services, and its review sentiment. Pull owner name from
brokers/registries; derive services and tone from their existing site or
GBP/Yelp listing; summarize recent reviews.

### 2.4 Data model (leads)

```
Lead {
  id, source, discovered_at
  business { name, category, address, geo, phone, hours, price_level }
  presence { has_site, url, score, category, screenshot_ref, issues[] }
  contacts { owner_name?, emails[], phones[], socials[] }
  enrichment { services[], review_summary, review_count, rating }
  status: NEW → QUALIFIED → DEMO_BUILT → CONTACTED → INTERESTED →
          CONVERTED → LIVE  (or REJECTED / DNC / DEAD)
  demo { preview_url, template_id, built_at, screenshots }
  outreach { attempts[], last_channel, transcript_refs, dispositions[] }
  billing { quote, paid_at, method, subscription? }
  compliance { dnc_checked, consent_basis, ai_disclosure_given }
}
```

---

## 3. Subsystem 2 — Autonomous Site Generation

The engine that makes the "I already built it" pitch possible at scale.

### 3.1 Strategy: template + LLM fill, not from-scratch generation

Generating a bespoke site from a blank canvas per lead is slow, expensive, and
inconsistent. Instead:

1. **A library of 8–15 vertical-specific templates** (landscaping, auto repair,
   plumbing, salon, restaurant, dental, etc.), each a clean, modern, mobile-
   first, conversion-oriented design (hero, services, gallery, reviews, service
   area, click-to-call, quote/booking form, map).
2. **An LLM fills the content**: headlines, service descriptions, about copy,
   CTA text — grounded in the enrichment data (real services, real reviews,
   real service area) so it's specific, not generic lorem.
3. **Assets**: pull their logo if one exists (from GBP/site); generate a
   palette from their brand or vertical; use stock/AI imagery for hero and
   gallery (relevant to the trade). Vision-model a screenshot of their storefront
   from Street View for authenticity where available.
4. **Data pre-filled** from Places: name, address, hours, phone, map embed,
   review snippets.

This gets cost-per-demo to pennies of compute + a few cents of image gen, and
build time to seconds.

### 3.2 Redesign vs. new build

- **New build (no site):** straight template fill.
- **Redesign (bad site):** scrape their existing content (services, copy, hours,
  photos) so the demo shows *their actual business* re-skinned — much more
  convincing than generic fill. "Here's your site, modernized" beats "here's a
  generic site."

### 3.3 Tech stack for the sites

- **Static-first**: Astro or Next.js static export, or a plain templated HTML/CSS
  system. Fast, cheap to host, great Core Web Vitals (which we then brag about).
- **Preview hosting**: each demo deployed to a unique subdomain
  (`joes-landscaping.previewsite.com`) — Vercel/Netlify/Cloudflare Pages, or an
  S3+CloudFront bucket per demo. Cloudflare Pages/Workers is cheapest at volume.
- **Booking/scheduling**: embed Calendly (there's a Calendly MCP connected to
  this workspace) or Cal.com, or a lightweight custom slot picker writing to a
  DB. For "customers schedule with them," Cal.com self-hosted is the cost-scalable
  option; Calendly is faster to ship.
- **Forms** → email/CRM webhook so leads from *their* customers land in the
  owner's inbox (a feature to demo: "and you already got a quote request").

### 3.4 Quality gate

Before a demo goes into outreach, auto-QA it: Lighthouse score threshold, no
broken images, no hallucinated services (validate against enrichment), no
offensive/wrong content. A cheap LLM-as-judge pass plus deterministic checks.
Anything that fails routes to a human review queue rather than getting pitched.

### 3.5 Note on available MCP tooling

This workspace has a **Higgsfield MCP** with `create_website` / `deploy_website`
and image/asset generation, and **Calendly MCP** for scheduling. Those are
plausible accelerators for a first prototype of the generation + booking layer,
though a production system at scale would likely want its own templating engine
for cost control and determinism. Worth prototyping with them to validate the
demo-quality bar before building custom.

---

## 4. Subsystem 3 — Autonomous Outreach (the hard, risky part)

### 4.1 Channels, in order of preference

1. **Email first** — cheapest, lowest legal risk (CAN-SPAM is permissive:
   accurate headers, physical address, working unsubscribe). Send the demo link.
   Great for warming before a call.
2. **SMS** — higher open/response, but **needs consent under TCPA**; cold SMS to
   mobiles is legally dangerous. Generally reserve SMS for leads who've engaged.
3. **Voice (AI cold call)** — the flashy centerpiece, and the highest-risk
   channel. Details below.

The realistic funnel is **email/voicemail drop → interested reply → live AI or
human call → close**, not "AI cold-calls 10,000 people." See §7 before treating
mass AI cold-calling as the plan.

### 4.2 The AI voice agent

**Stack options:**
- **All-in-one voice agent platforms**: Vapi, Retell AI, Bland AI — handle
  telephony + streaming STT + LLM + TTS + turn-taking/interruption out of the
  box. Fastest path. Retell/Vapi are the current go-tos for outbound AI calling.
- **Assemble it yourself**: Twilio (telephony/SIP) + Deepgram (STT) +
  GPT/Claude (dialogue) + ElevenLabs/Cartesia (TTS) + a turn-taking/VAD layer
  (LiveKit Agents or Pipecat as the orchestration framework). More control, more
  work, cheaper at very high volume.

**Conversation design:**
- A **structured dialogue policy**, not a free-for-all LLM. States: intro +
  **AI disclosure** → hook ("I built you a website, want to see it?") → handle
  objection → send link via SMS/email live → gauge interest → book a follow-up
  or close → graceful exit + DNC honoring.
- **Guardrails**: no false claims, no impersonating a human when asked, no
  pressure tactics, hard stop on "remove me / not interested," profanity/abuse
  handling, and a bail-to-human path.
- **Latency budget** < ~800ms round-trip or it feels robotic — this drives the
  vendor choice.
- **Warm handoff**: when a lead is hot, transfer to a human closer (or a booked
  call), because a human closes \$1k deals better than a bot, and it de-risks
  the "AI pressured me into paying" problem.

### 4.3 Telephony & deliverability ops

- Local presence dialing (area-code-matched caller ID) improves pickup.
- Number rotation + reputation management to avoid spam-flagging (STIR/SHAKEN
  attestation, register numbers, monitor spam-labeling).
- Voicemail detection → drop a pre-recorded/TTS voicemail with the link.
- Call windows: respect local calling-hours law (8am–9pm local, stricter in
  some states).

### 4.4 Orchestration / campaign engine

A worker system that: pulls QUALIFIED leads with a built demo, checks
compliance (DNC, hours, consent), dials/sends, records disposition, schedules
retries with backoff, and moves leads through the funnel. Every interaction
logged with transcript + recording (recording consent laws vary — see §7).

---

## 5. Subsystem 4 — Conversion & Fulfillment

- **Payment**: Stripe Checkout / payment link sent during or right after the
  call. \$1,000 one-time, or better, **\$1k + a hosting/maintenance
  subscription** (\$25–50/mo) — recurring revenue is what makes this a business
  rather than a hustle, and it covers ongoing hosting/domain cost.
- **Domain**: register on their behalf (Namecheap/Cloudflare API) or connect a
  domain they own. Handle DNS automatically.
- **Go-live**: promote the preview to production, wire up their domain, SSL,
  business email forwarding, connect the booking calendar and form-to-inbox.
- **Handoff**: owner dashboard to edit hours/services/photos, see booking
  requests, and reach support. Keep it minimal — most churn to editing means
  they don't want to self-serve.
- **Retention**: the recurring plan buys hosting, small edits, and keeps the
  booking widget running. This is also where you upsell (SEO, ads, review
  management).

---

## 6. System architecture (how the pieces run)

```
                    ┌────────────────────────────────────────────┐
                    │              Orchestrator / Queue            │
                    │   (Temporal or a job queue: BullMQ/SQS)      │
                    └───────────────┬──────────────────────────────┘
        ┌───────────────────┬───────┴───────┬────────────────┬──────────────┐
        ▼                   ▼               ▼                ▼              ▼
  Discovery Worker    Enrichment Worker  Site-Gen Worker  Outreach Worker  Billing/Deploy
  (Places/Yelp)       (brokers, scrape)  (template+LLM)   (voice/SMS/email) (Stripe/DNS)
        │                   │               │                │              │
        └───────────────────┴───────┬───────┴────────────────┴──────────────┘
                                     ▼
                       ┌──────────────────────────┐
                       │   Central data store       │
                       │  Postgres (leads/state)    │
                       │  + object store (demos,     │
                       │    screenshots, recordings) │
                       │  + vector store (optional)  │
                       └──────────────────────────┘
                                     │
                       ┌──────────────────────────┐
                       │  Ops dashboard + human     │
                       │  review/close queue        │
                       └──────────────────────────┘
```

**Why a durable workflow engine (Temporal or similar):** each lead is a long-
running, multi-day stateful process with retries, human-in-the-loop steps, and
external callbacks (a call happens, a payment webhook fires, an email is
replied to). Modeling each lead as a durable workflow beats a pile of cron jobs.

**Guiding principles:**
- **Qualify before you spend.** Cheap filters (has phone? in target vertical?
  no/bad site? not on DNC?) gate the expensive steps (demo build, live call).
- **Human-in-the-loop where it matters.** Auto-build and auto-email; put a human
  on the actual \$1k close and on QA of anything sketchy.
- **Everything logged and reversible.** Full audit trail per lead for
  compliance, dispute handling, and funnel analytics.
- **Idempotent workers + backpressure** so a retry storm doesn't double-call
  someone or blow the API budget.

---

## 7. Legal, ethical & compliance reality (read before building)

This is not a footnote — it determines what parts of the vision are actually
launchable. I'd be doing you a disservice to hand you an architecture without
flagging these clearly.

- **AI cold-calling (TCPA, USA):** The FCC has ruled that **AI-generated /
  cloned voices in robocalls count as "artificial or prerecorded voice" and
  require prior express consent** for non-emergency calls to consumers.
  Unsolicited AI voice calls to people who never opted in is exactly the
  fact-pattern regulators are cracking down on. Penalties are per-call and
  large. **Mass autonomous AI cold-calling of cold leads is the single riskiest
  part of this plan.** Viable adaptations: call **business** lines (B2B has more
  latitude than B2C, but not unlimited), get consent first via email/web opt-in,
  use AI for *inbound* and *warm* calls, and keep a human in outbound loops.
- **AI-voice disclosure laws:** Several states (e.g. California's bot-disclosure
  law) require disclosing you're talking to a bot. Bake disclosure into the
  script's first turn regardless.
- **Do-Not-Call:** Scrub against the **National DNC Registry** and maintain your
  own internal DNC. Honor opt-outs instantly and permanently.
- **Call recording:** Two-party-consent states require announcing recording.
- **SMS (TCPA/CTIA):** Cold SMS to mobiles without consent is high-risk; 10DLC
  registration required; carriers filter aggressively.
- **Email (CAN-SPAM):** The most permissive channel — legal for cold B2B if you
  use accurate headers, identify yourself, include a physical address, and honor
  unsubscribes.
- **Scraping (ToS + CFAA):** Prefer official APIs (Places, Yelp). Scraping
  Google Maps violates ToS. Scraping a target's *own public site* to redesign it
  is lower-risk but still respect robots.txt and don't hammer.
- **Using their brand/content:** Building a demo with their name/logo/photos for
  a genuine sales offer is generally defensible, but don't publish it publicly
  as if it's their official live site, and take it down on request.
- **Consumer-protection / UDAP:** The pitch must be truthful. "I built you a
  site" is fine; fake urgency, fake scarcity, or implying you're affiliated with
  Google/their existing provider is not.

**Practical posture:** lead with **email + demo link** (low risk), use **voice
for warm/consented and inbound**, keep **humans on closes**, and treat "fully
autonomous AI cold-calls everyone" as the part to *scope down*, not the
centerpiece. The autonomy shines in discovery, enrichment, demo generation, and
follow-up — which is where the real leverage is anyway.

---

## 8. Unit economics (rough, to pressure-test viability)

Illustrative per-lead costs (order-of-magnitude, not quotes):

| Step | Cost per lead | Notes |
|---|---|---|
| Discovery (Places/Yelp) | \$0.01–0.05 | batched, per-record |
| Enrichment (broker/registry) | \$0.05–0.50 | optional, owner contact |
| Site generation (LLM + images + host) | \$0.10–1.00 | template fill keeps this low |
| Email outreach | ~\$0.001 | negligible |
| AI voice call | \$0.05–0.30 / min | 2–4 min call → ~\$0.20–1.00 |
| Human closer (on hot leads only) | \$\$ | gate behind interest |

If a full touch (build + email + one call) costs ~\$1–2 and you convert even
1–2% of contacted leads at **\$1,000 + \$35/mo**, the math is strongly positive
— *if* compliance is handled and deliverability holds. The sensitivity is all in
**conversion rate** and **not getting your numbers/domains blacklisted**, which
is why qualification and channel discipline matter more than raw volume.

**LTV lever:** the recurring hosting/maintenance subscription is what turns a
one-time \$1k into a real business. Prioritize it.

---

## 9. Scaling plan

- **Geographic + vertical sharding:** run campaigns per (metro × vertical). Each
  shard is an independent pipeline instance; add shards to scale horizontally.
- **Template library growth:** each new vertical template unlocks a new segment
  at near-zero marginal build cost.
- **Cost control:** cache Places results, dedupe across sources, cheap-model the
  bulk LLM work and reserve strong models for the closer/QA, self-host hosting
  (Cloudflare) and booking (Cal.com) once volume justifies it.
- **Deliverability at scale:** pools of rotating numbers and warmed sending
  domains/IPs; monitor spam-flag and bounce rates as first-class metrics; throttle
  per-number/per-domain.
- **Human capacity:** the bottleneck becomes closers and QA reviewers, not
  compute. Design the queue so one human handles many hot leads (AI books,
  human closes). Track closer conversion and demo-QA pass rate.
- **Feedback loop:** log which templates, scripts, verticals, and metros convert
  best; feed that back into targeting and template/script selection. This is the
  compounding advantage over time.

---

## 10. Suggested build order (when we start)

1. **Discovery + presence scoring** (Places API → scored lead list). Cheap,
   immediately useful, no legal exposure. Prove you can find good targets.
2. **Site generation** (pick 2 verticals, build templates, LLM fill, preview
   hosting, QA gate). Prove demo quality + cost-per-demo.
3. **Email outreach + tracking** (send demo links, track opens/clicks/replies).
   Lowest-risk channel; validates whether the "already built it" hook converts
   at all before investing in voice.
4. **Conversion plumbing** (Stripe, domain/deploy, booking). Close a few by hand.
5. **Voice agent** — *last*, and start with **warm/inbound + consented**, humans
   on closes, full compliance scaffolding. Expand cautiously.

Deliberately front-loads the high-leverage, low-risk work and defers the
legally fraught autonomous-cold-calling piece until the funnel is proven and the
compliance guardrails exist.

---

## 11. Open questions to decide before building

- **B2B-only calling, or consumer?** (Changes the entire legal posture.)
- **Buy vs. build the voice stack?** (Vapi/Retell to start, in-house later.)
- **How much human-in-the-loop** on closes — fully auto, or AI-books/human-closes?
- **Pricing**: one-time \$1k, or \$1k + subscription, or subscription-only?
- **Geographic focus** for the first campaign (one metro + one vertical to start).
- **Which MCP tools to prototype with** (Higgsfield for generation, Calendly for
  booking) vs. build custom from day one.

---

## 12. Implementation status

The MVP in this folder now implements, end-to-end and fully tested offline:

- ✅ Full mock funnel (discover → qualify → sitegen → cadence outreach → convert)
- ✅ Multi-day cadence engine (`cadence.py`): email d0 → voice d1 → follow-up d3
  → honest breakup d7, with per-lead stop conditions (interested/declined/DNC)
- ✅ A/B testing of intro subject + call opener, with per-variant funnel stats
- ✅ Truthful-outreach invariant: copy adapts to whether the lead has a site
  (never claims "can't find you online" to a business that has a website)
- ✅ Live providers (stdlib-only, offline-tested via fake transports):
  Google Places discovery, heuristic presence audit, Anthropic content writer
  (grounding enforced in code), SMTP email (CAN-SPAM footer required),
  Stripe Checkout (webhook-confirmed), Vapi voice (double-gated)
- ✅ Dashboard: funnel, A/B table, human review queue, close queue, audit trails
- ✅ `doctor` command: configuration status + what each missing key unlocks
- ⛔ Live enrichment (broker choice pending) · Stripe/Vapi webhook receivers ·
  metro grid-tiling · deploy-to-production (LIVE status) flow
