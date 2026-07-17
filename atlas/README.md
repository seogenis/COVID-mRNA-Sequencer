# Atlas

A spatial strategy & task map for **undefined problem spaces** — the hybrid of
Notion and Obsidian built for how startups actually work: you have to figure out
*what* to do and *do it* at the same time.

Instead of a flat task list (Notion) or an unstructured note graph (Obsidian),
Atlas puts everything in a navigable 3D space where **position carries meaning**.

Built for Synphony; nothing about it is Synphony-specific — reseed it for any team.

---

## The core idea: three axes, three altitudes

Every node has a position, and each axis means something:

| Axis | Meaning | Example |
| --- | --- | --- |
| **Height (Y)** | **Altitude** — how abstract the work is | strategy is up high, execution is down low |
| **Left → right (X)** | **Time** — past on the left, roadmap on the right | a `NOW` wall marks today |
| **Into the screen (Z)** | **Branch** — which strategic thread it belongs to | "China supply chain" vs "Robot data strategy" |

The three altitudes are the backbone:

- **Strategy** — high-level bets & concepts. What execs care about.
  *("Win information asymmetry in China", "UMI-style data vs VLA teleoperation".)*
- **Project** — micro-projects with concrete deliverables. Shared by everyone.
- **Execution** — the specific next actions. *("Email Jeff Monday", "Follow up with Jared".)*

Execs live in the top two floors, builders in the bottom two, and the **Project**
floor is the shared middle where they meet — so everyone can always see what
everyone else is doing, at the altitude that matters to them.

---

## What you can do

- **Fly through the space** — orbit (drag), pan (right-drag / two-finger), zoom
  (scroll), Desmos-style.
- **Focus presets** — `Executive` (Strategy + Project) and `Builder`
  (Project + Execution) instantly hide the floor you don't need.
- **Create / edit / delete nodes** — each node is typed (strategy, task, info,
  question, decision), has a status, an owner, a date, a branch, and a markdown
  body (so a node can be a whole folder of thinking, Obsidian-style).
- **Connect nodes** — typed edges: `contains` (hierarchy across floors),
  `depends on`, `relates to`. Pick a link type in the inspector, then click a
  target node in the space.
- **Drag to reposition** — nudge a node on its floor; it pins in place. "Re-snap
  layout" returns everything to its time/altitude/branch position.
- **Filter everything** — by altitude, type, status, branch, or full-text search.
  Non-matching nodes dim (or hide).
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

```bash
cd atlas
npm install
npm run dev      # opens http://localhost:5173
```

Build a static bundle:

```bash
npm run build    # outputs to dist/
npm run preview
```

---

## Stack

- **React + TypeScript + Vite**
- **three.js** via **@react-three/fiber** + **@react-three/drei** for the 3D scene
- **zustand** (with `persist`) for state + local-storage persistence

No backend. Everything is client-side, which makes it trivial to deploy as a
static site or lift into its own repo.

---

## Layout of the code

```
src/
  types.ts          domain model (Node, Edge, Branch, Commit, Filters)
  config.ts         axis math + colour/label maps (altitude, type, status, edges)
  seed.ts           the Synphony starter graph
  store.ts          zustand store: all state + actions + persistence + commit log
  lib/
    layout.ts       world-position math + filter matching
    markdown.ts     tiny dependency-free markdown renderer for node bodies
    ai.ts           offline heuristic + optional Anthropic API organizer
  scene/
    Scene.tsx       canvas, camera, orbit controls, node drag
    LevelPlanes.tsx the three altitude floors
    TimeGrid.tsx    month gridlines + NOW marker
    Edges.tsx       typed connection lines
    NodeMesh.tsx    a single node (box + floating HTML card)
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
