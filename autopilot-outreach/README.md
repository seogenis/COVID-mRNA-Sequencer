# Autopilot Outreach

An autonomous system that discovers local small businesses, evaluates their web
presence, builds or redesigns a website for them on spec, and then reaches out
(including via AI voice calls) to sell it — "I already built you a site, want to
see it free? Keep it for $1,000."

**Status:** Design / brainstorm only. No implementation yet.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full architecture, tooling
decisions, scale plan, unit economics, and — critically — the legal/compliance
constraints that shape the whole thing.

## The four subsystems at a glance

1. **Discovery** — find businesses in a geographic area, enrich with contact
   info and current web presence.
2. **Site generation** — for each lead, auto-build a demo website (new build or
   redesign) hosted on a preview URL.
3. **Outreach** — multi-channel (voice/SMS/email) autonomous contact, with an
   AI voice agent that pitches and books.
4. **Conversion & fulfillment** — payment, handoff, domain/deploy, scheduling
   widget, ongoing hosting.

## Read this first

This concept touches several regulated areas: automated calling (TCPA/state
law), web scraping (ToS + CFAA), and AI-voice disclosure laws. The design doc
does **not** treat these as footnotes — they determine what's viable. Section 7
covers them in detail.
