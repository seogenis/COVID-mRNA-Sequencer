# Testing & debugging Atlas

Three ways to run it, from zero-effort to full-featured.

## Path 1 — double-click, no install (fastest)

Download / open **`atlas-standalone.html`** in any browser. That's it.

- One self-contained file (~1 MB): all JS/CSS inlined, zero network requests.
- Everything works **except the ✦ AI features** (they call Anthropic directly,
  which this build disables — use Path 2 for AI).
- Your data persists in the browser's localStorage per page location.

Rebuild it after code changes with `npm run build:single`.

## Path 2 — dev server (full app, AI included)

```bash
cd atlas
npm install
npm run dev        # opens http://localhost:5173, hot-reloads on edit
```

For the AI features: ⚙ Settings → paste an Anthropic API key (`sk-ant-…`).
The key lives only in your browser's localStorage and calls Anthropic
directly from the page.

## Path 3 — automated smoke test

```bash
npm run test:e2e
```

Rebuilds the standalone file, drives it in headless Chromium (Playwright),
and runs 21 checks: render, onboarding, outline fly-to, editing, node
creation (button + double-click empty canvas), **dragging a card across a band
to change its altitude**, undo, people facet, progress rollup, search fly-to,
status-dot advance, focus presets, history, AI-modal state — failing on any
console error or unexpected network request. On a machine without Playwright's
bundled browser it falls back to your installed Chrome; you can also point
it at a specific binary:

```bash
PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome npm run test:e2e
```

The AI pipeline itself is tested with a **mocked** Anthropic API inside the
smoke test — no key or network needed.

---

## A 3-minute manual tour

1. **Onboarding** appears on first run — read it, then *Explore the space*.
2. **Move**: drag the background to pan, scroll to zoom (toward the cursor).
   Lost? Press **F** or click **⤢ Frame all** (bottom-right).
3. **Drag a card** — this is the gesture that was broken before. Grab any card
   and move it: **up/down across a band changes its altitude**, sideways
   changes its date. Drop it and the inspector reflects the new level.
4. **Organized layout**: hit **❖ Organized** (bottom-right) — the space
   auto-arranges into a tidy branch × altitude grid with labelled columns.
   **◱ Timeline** switches back to the date view.
5. **Outline** tab (left panel) — click any node to fly to it. Double-clicking
   a card on the canvas does the same.
6. **Create in place**: double-click empty canvas — the node is born with that
   spot's date and altitude, ready to title.
7. **Edit**: click a card → inspector (right). Its connected cards light up and
   the rest dim. Notice parents show a progress bar rolling up their children
   (e.g. *Qualify 3 actuator suppliers* → 1/2).
8. **People**: Filters → *People* — uncheck someone to fade their work out.
   That plus **Executive / Builder** is the "what matters to me" view.
9. **Search**: type in the top bar (match count shows) and press **Enter** to
   fly to each match in turn.
10. **Check things off in place**: click the status dot on any card to advance
    it (todo → doing → done) — watch the parent's progress bar move.
11. **Link**: in the inspector click *depends on →*, then click another card.
12. **Undo**: delete something with Backspace, bring it back with **Ctrl/⌘+Z**
    (or the ↩ button).
13. **History**: edit someone else's strategy node (owner ≠ you) and see it
    flagged for approval.
14. **AI** (dev build + key): ✦ → *Compose* → paste a messy paragraph of
    company thoughts → *Structure this* → review → *Add to space*. Then select
    a strategy node → *Break into projects*.

## Debug toolkit

| Problem | Fix |
| --- | --- |
| Deleted / changed something by accident | **Ctrl/⌘+Z** or the ↩ toolbar button (structural changes, incl. AI applies) |
| Space looks wrong / want a clean slate | ⚙ Settings → **Reset to seed** |
| Camera lost in the void | **F** key or **⤢ Frame all** |
| Wondering what changed | **History** button (top-right) |
| Inspect raw state | DevTools console: `JSON.parse(localStorage.getItem('atlas-store-v1'))` |
| Hard reset (nukes everything incl. intro flag) | DevTools: `localStorage.clear()` then reload |
| Snapshot / restore state | ⚙ Settings → **Export JSON** / **Import JSON** |
| AI errors | The modal shows the exact API error (401 bad key, 429 rate limit, network). Model id is configurable in Settings. |
| Re-see the intro | **?** button (bottom-right) |

## Where state lives

Everything is client-side in `localStorage` under key **`atlas-store-v1`**
(nodes, edges, branches, commits, filters, settings — including your API key).
`atlas-seen-intro-v1` tracks the one-time intro. Different origins
(`file://` page vs `localhost:5173`) have separate storage, so the standalone
file and the dev server each keep their own data — use Export/Import JSON to
move a space between them.
