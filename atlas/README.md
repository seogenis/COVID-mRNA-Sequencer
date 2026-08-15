# Atlas

A spatial strategy & task map for **undefined problem spaces** — the hybrid of
Notion and Obsidian built for how startups actually work: you have to figure out
*what* to do and *do it* at the same time.

Instead of a flat task list (Notion) or an unstructured note graph (Obsidian),
Atlas puts everything on a navigable 2D canvas where **position carries meaning**
— pan, zoom, and drag like Obsidian Canvas.

Built for Synphony; nothing about it is Synphony-specific — reseed it for any team.

---

## The core idea: three altitudes on a time canvas

Every card has a position, and the position means something:

| Axis | Meaning | Example |
| --- | --- | --- |
| **Rows (↕)** | **Altitude** — how abstract the work is | Strategy on top, Execution at the bottom |
| **Columns (↔)** | **Time** — past on the left, roadmap on the right | a `NOW` line marks today |
| **Colour (●)** | **Branch** — which strategic thread it belongs to | "China supply chain" vs "Robot data strategy" |

The three altitude bands are the backbone:

- **Strategy** — high-level bets & concepts. What execs care about.
  *("Win information asymmetry in China", "UMI-style data vs VLA teleoperation".)*
- **Project** — micro-projects with concrete deliverables. Shared by everyone.
- **Execution** — the specific next actions. *("Email Jeff Monday", "Follow up with Jared".)*

Execs live in the top two bands, builders in the bottom two, and the **Project**
band is the shared middle where they meet — so everyone can always see what
everyone else is doing, at the altitude that matters to them.

**Dragging is the core gesture:** drag a card up or down and it changes altitude;
drag it sideways and it reschedules. Where you put it *is* what it means.

---

## What you can do

- **Navigate** — drag the background to pan, scroll to zoom (toward the cursor).
  **Double-click a card** to zoom to it; **F** / **⤢ Frame all** fits everything.
- **Two layouts** (toggle, bottom-right): **Timeline** places cards by date;
  **Organized** auto-arranges them into a tidy branch × altitude grid — every
  strategic thread becomes its own labelled column crossed by the three bands,
  so the structure reads at a glance.
- **Outline view** — a Notion-style list of every node by branch → altitude in
  the left panel; click to fly there.
- **First-run onboarding** — a dismissible overlay explains the layout and
  controls (reopen with the **?** button).
- **Focus presets** — `Executive` (Strategy + Project) and `Builder`
  (Project + Execution) instantly hide the floor you don't need.
- **Create / edit / delete nodes** — each node is typed (strategy, task, info,
  question, decision), has a status, an owner, a date, a branch, and a markdown
  body (so a node can be a whole folder of thinking, Obsidian-style).
  **Double-click empty canvas** to create a node right there — the position sets
  its date and altitude. **Ctrl/⌘+Z** undoes structural changes (moves, adds,
  deletes, AI applies).
- **Drag to reposition** — grab a card and move it; drag across a band to change
  its **altitude**, sideways to change its **date**. Click a card's status dot to
  advance it (todo → doing → done).
- **People lens** — filter the canvas by owner; selecting a card lights up its
  connections and dims the rest; parent cards show a progress bar rolling up their
  children, so the Strategy band reflects live execution state.
- **Connect nodes** — typed edges: `contains` (hierarchy), `depends on`,
  `relates to`. Pick a link type in the inspector, then click a target card.
- **Filter everything** — by altitude, type, status, branch, person, or full-text
  search. Non-matching cards dim (or hide).
- **Change history** — a lightweight commit log. Edits to *strategy-level* nodes
  by someone other than their author are flagged for **approval** — the seed of a
  GitHub-style push/review flow. (No logins yet; you just set your name.)
- **AI (the ✦ button)** — add an Anthropic API key in Settings, then:
  - **Compose** — paste a raw brain-dump (messy is fine) and Claude lays it out
    across the three altitudes into typed nodes, branches, and edges. You preview
    the whole subgraph and nothing changes until you hit *Add to space*.
  - **Connect** — Claude scans existing nodes and proposes relationships you
    haven't drawn yet (dependencies, loose links).
  - **Organize** — propose altitude/branch reassignments (plus an offline
    heuristic that runs with no key).
  - **Break down** — from any node's inspector, decompose it into its children
    one altitude lower (a strategy → projects, a project → tasks).
- **Import / export JSON** and **Reset to seed**. State persists in your browser's
  local storage — no backend, no account.

---

## Run it

**Zero-install:** open [`atlas-standalone.html`](./atlas-standalone.html) in any
browser — one self-contained file, no server, no network. (AI features need the
dev build below.)

**Full app:**

```bash
cd atlas
npm install
npm run dev      # opens http://localhost:5173
```

Other commands:

```bash
npm run build         # production bundle → dist/
npm run build:single  # regenerate atlas-standalone.html
npm run test:e2e      # headless-browser smoke test (21 checks, AI mocked)
```

See **[TEST.md](./TEST.md)** for a 3-minute manual tour and the debug toolkit
(state inspection, resets, common fixes).

---

## Stack

- **React + TypeScript + Vite** — no 3D/WebGL dependency; the canvas is plain
  DOM + SVG, so it's ~230 KB (72 KB gzipped) and loads instantly.
- **zustand** (with `persist`) for state + local-storage persistence

No backend. Everything is client-side, which makes it trivial to deploy as a
static site or lift into its own repo.

---

## Layout of the code

```
src/
  types.ts          domain model (Node, Edge, Branch, Commit, Filters)
  config.ts         colour/label maps (altitude, type, status, edges)
  seed.ts           the Synphony starter graph
  store.ts          zustand store: all state + actions + persistence + undo + commit log
  lib/
    layout.ts       filter matching
    markdown.ts     tiny dependency-free markdown renderer for node bodies
    ai.ts           offline heuristic + optional Anthropic API (compose/connect/decompose)
    env.ts          hosted-mode flag
  canvas/
    Canvas.tsx      the 2D viewport: pan / zoom / drag / frame animation
    NodeCard.tsx    a draggable card
    EdgeLayer.tsx   SVG connection curves
    layout2d.ts     time↔x and altitude↔y band math (and their inverses)
  ui/
    Toolbar.tsx     top bar: focus presets, search, add, organize, history
    SidePanel.tsx   left: filters + branches + legend
    Inspector.tsx   right: full node editor + connections
    HistoryDrawer.tsx   commit log + approvals
    SettingsModal.tsx   name, API key, import/export, reset
    AiModal.tsx     organize suggestions
    LinkingBanner.tsx   the "click a target node" hint
```

---

## Roadmap ideas (not built yet)

These were intentionally deferred to keep v1 focused:

- **Real multi-user** — accounts, presence, and the full push/review flow the
  commit log is scaffolding for. Today it's single-user with a name field.
- **Live backend / sync** — swap local storage for a shared store (e.g. a small
  server or a realtime DB) so a team sees the same space.
- **Streaming AI + inline diff** — stream Compose results into the space live,
  and show applied AI changes as a reviewable diff in the commit log.
- **Node attachments** — files/images inside a node's body.
- **Saved camera bookmarks** — jump to "the China corner" or "this quarter".
