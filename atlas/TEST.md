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
and checks 12 things: render, onboarding, outline fly-to, editing, node
creation, focus presets, history, AI-modal state — failing on any console
error or unexpected network request. On a machine without Playwright's
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
2. **Move**: drag to orbit, scroll to zoom, right-drag to pan. Lost? Press
   **F** or click **⤢ Frame all** (bottom-right).
3. **Outline** tab (left panel) — click any node to fly to it. Double-clicking
   a node in 3D does the same.
4. **Edit**: click a node → inspector (right). Change its altitude and watch it
   move floors.
5. **Filters**: uncheck *Execution*, or use the **Executive / Builder** presets
   in the toolbar.
6. **Link**: in the inspector click *depends on →*, then click another node.
7. **History**: edit someone else's strategy node and see it flagged for
   approval.
8. **AI** (dev build + key): ✦ → *Compose* → paste a messy paragraph of company
   thoughts → *Structure this* → review → *Add to space*. Then select a
   strategy node → *Break into projects*.

## Debug toolkit

| Problem | Fix |
| --- | --- |
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
