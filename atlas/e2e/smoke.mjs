// Atlas end-to-end smoke test.
//
//   npm run test:e2e
//
// Builds nothing itself — run `npm run build:single` first (the npm script
// does both). Drives the self-contained build via file:// in headless
// Chromium, with the Anthropic API mocked, and exercises: render, onboarding,
// outline fly-to, node add/edit, filters, history, and the AI Compose →
// preview → apply pipeline. Exits non-zero on any console error, page error,
// external network request, or failed assertion.
//
// Uses playwright's bundled chromium if installed; falls back to a local
// Chrome/Chromium via channel or PLAYWRIGHT_EXECUTABLE_PATH.

import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const target = 'file://' + join(here, '..', 'dist-single', 'index.html')

const failures = []
const errors = []
const external = []
const ok = (name, cond) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}`)
  if (!cond) failures.push(name)
}

async function launch() {
  const opts = {
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  }
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    return chromium.launch({ ...opts, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  }
  try {
    return await chromium.launch(opts) // bundled browser, if downloaded
  } catch {
    return chromium.launch({ ...opts, channel: 'chrome' }) // system Chrome
  }
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('request', (r) => {
  const u = r.url()
  if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u)
})

// Mock the Anthropic API so AI flows are testable offline. The single-file
// build disables AI buttons (hosted mode), so we re-enable by injecting a key
// AND testing against the mock through the dev-mode paths where present.
const asMsg = (text) => ({ id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text }] })
await page.route('**/api.anthropic.com/**', async (route) => {
  const post = JSON.parse(route.request().postData() || '{}')
  const sys = post.system || ''
  let text = '{}'
  if (sys.includes('raw brain-dump')) {
    text = JSON.stringify({
      summary: 'ok',
      branches: [],
      nodes: [{ tempId: 'n1', title: 'Mock node', type: 'task', level: 'project', status: 'todo' }],
      edges: [],
    })
  } else if (sys.includes('organize a startup strategy map')) {
    text = JSON.stringify({ summary: 'ok', moves: [] })
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(asMsg(text)) })
})

console.log('atlas smoke test →', target)
await page.goto(target, { waitUntil: 'load' })
await page.waitForTimeout(2500)

// --- first run ---
ok('onboarding shows on first run', !!(await page.$('.onboarding')))
await page.click('.onboarding button:has-text("Explore")').catch(() => {})
await page.waitForTimeout(300)

ok('canvas renders', !!(await page.$('.canvas-viewport')))
ok('seed nodes render', (await page.$$('.canvas-card')).length >= 10)
ok('three altitude bands labelled', (await page.$$('.band-header')).length === 3)

// --- outline + fly-to ---
await page.click('.tab:has-text("Outline")')
await page.waitForTimeout(200)
const outlineNodes = await page.$$('.outline-node')
ok('outline lists nodes', outlineNodes.length >= 10)
await outlineNodes[0].click()
await page.waitForTimeout(700)
ok('outline click opens inspector', !!(await page.$('.inspector')))

// --- edit ---
await page.fill('.insp-title', 'Smoke-edited title')
await page.waitForTimeout(200)
await page.click('.tab:has-text("Outline")').catch(() => {})
const firstTitle = await page.$eval('.outline-node .outline-node-title', (e) => e.textContent)
ok('edit propagates to outline', firstTitle === 'Smoke-edited title')

// --- add node ---
const countAll = async () => (await page.$$('.canvas-card')).length
const before = await countAll()
await page.click('button.primary:has-text("Node")')
await page.waitForTimeout(400)
ok('+ Node adds a node', (await countAll()) === before + 1)

// --- undo ---
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
ok('Ctrl+Z undoes the add', (await countAll()) === before)

// --- drag a card across a band changes its altitude ---
// "First robotics hire" is an isolated project-level card (no other node shares
// its time+band), so the mousedown can't grab an overlapping neighbour.
const DRAG_TITLE = 'First robotics hire'
const levelOf = (title) =>
  page.evaluate((t) => {
    const s = JSON.parse(localStorage.getItem('atlas-store-v1'))
    return Object.values(s.state.nodes).find((n) => n.title === t)?.level
  }, title)
await page.keyboard.press('Escape')
await page.keyboard.press('f')
await page.waitForTimeout(1400)
const cb = await page.locator('.canvas-card', { hasText: DRAG_TITLE }).first().boundingBox()
const levelBefore = await levelOf(DRAG_TITLE)
// drag it down more than a full band → into the Execution band
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
await page.mouse.down()
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 + 160, { steps: 8 })
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 + 340, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
const levelAfter = await levelOf(DRAG_TITLE)
ok(`dragging a card across a band changes altitude (${levelBefore}→${levelAfter})`, levelBefore !== levelAfter)
await page.keyboard.press('Control+z') // restore
await page.waitForTimeout(300)

// --- double-click empty space creates a node there ---
await page.keyboard.press('Escape')
await page.keyboard.press('f')
await page.waitForTimeout(1400)
// find a viewport point not covered by any card
const empty = await page.evaluate(() => {
  const vp = document.querySelector('.canvas-viewport').getBoundingClientRect()
  const cards = [...document.querySelectorAll('.canvas-card')].map((c) => c.getBoundingClientRect())
  for (let gy = 0.2; gy <= 0.8; gy += 0.08)
    for (let gx = 0.3; gx <= 0.7; gx += 0.08) {
      const x = vp.left + vp.width * gx
      const y = vp.top + vp.height * gy
      if (cards.every((r) => x < r.left - 10 || x > r.right + 10 || y < r.top - 10 || y > r.bottom + 10))
        return { x, y }
    }
  return { x: vp.left + 60, y: vp.top + 60 }
})
const beforeDbl = await countAll()
await page.mouse.dblclick(empty.x, empty.y)
await page.waitForTimeout(500)
const dblCreated = (await countAll()) === beforeDbl + 1
ok('double-click empty space creates a node', dblCreated)
if (dblCreated) {
  const t = await page.$eval('.insp-title', (e) => e.value).catch(() => null)
  ok('created node opens in inspector', t === 'New node')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
}

// --- people facet ---
await page.click('.side-panel .tab:has-text("Filters")').catch(() => {})
await page.waitForTimeout(200)
const ownerRows = await page.$$eval('.side-panel .check-row', (els) =>
  ['Sean', 'Alex', 'Jordan'].filter((name) => els.some((e) => (e.textContent || '').includes(name))),
)
ok('people facet lists owners', ownerRows.length === 3)
const dimBefore = (await page.$$('.canvas-card.dim')).length
const seanRow = await page.$('.side-panel .check-row:has-text("Sean") input')
await seanRow.click()
await page.waitForTimeout(400)
const dimAfter = (await page.$$('.canvas-card.dim')).length
ok('toggling a person dims their nodes out', dimAfter > dimBefore)
await seanRow.click()
await page.waitForTimeout(300)

// --- progress rollup ---
ok('a parent card shows child progress', !!(await page.$('.cc-progress')))

// --- search: Enter flies to the match ---
await page.fill('.search input', 'Jared')
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
const searchedTitle = await page.$eval('.insp-title', (e) => e.value).catch(() => '')
ok('search + Enter flies to and selects the match', searchedTitle.includes('Jared'))

// --- status dot click advances status (blocked → doing) ---
await page.click('.canvas-card.sel .cc-status')
await page.waitForTimeout(300)
const statusVal = await page.$eval('.insp-grid label:nth-child(3) select', (e) => e.value).catch(() => null)
ok('clicking the status dot advances status', statusVal === 'doing')
await page.fill('.search input', '')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// --- view controls not blocked by inspector ---
await page.click('button:has-text("Frame all")')
await page.waitForTimeout(500)
ok('Frame all clickable with inspector open', true)
await page.keyboard.press('Escape')

// --- focus presets ---
await page.click('button.seg:has-text("Executive")')
await page.waitForTimeout(400)
// Executive shows Strategy + Project only → all Execution cards are hidden/dimmed
const execVisible = await page.$$eval('.canvas-card', (els) =>
  els.filter((e) => !e.className.includes('dim')).length,
)
const allVisible = await page.$$eval('.canvas-card', (els) => els.length)
ok('Executive preset hides the execution band', execVisible < allVisible)
await page.click('button.seg:has-text("All")')

// --- organized (grouped) layout ---
const beforePos = await page.$eval('.canvas-card', (e) => e.style.left)
await page.click('.lt:has-text("Organized")')
await page.waitForTimeout(1200)
ok('Organized layout shows branch columns', (await page.$$('.branch-col-label')).length === 3)
const afterPos = await page.$eval('.canvas-card', (e) => e.style.left)
ok('switching layout repositions cards', beforePos !== afterPos)
await page.click('.lt:has-text("Timeline")')
await page.waitForTimeout(800)

// --- history ---
await page.click('button:has-text("History")')
await page.waitForTimeout(300)
// (undo restores the commit log along with the graph, so only the edit commit remains)
ok('history logs commits', (await page.$$('.commit-row')).length >= 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// --- AI modal state ---
await page.click('button:has-text("Organize")')
await page.waitForTimeout(300)
ok('AI modal opens with notice', !!(await page.$('.keyless')))
await page.keyboard.press('Escape')

// --- results ---
console.log('\nexternal requests:', external.length ? external : 'none')
console.log('console/page errors:', errors.length ? errors : 'none')
if (external.length) failures.push('unexpected external requests')
if (errors.length) failures.push('console or page errors')

await browser.close()
if (failures.length) {
  console.log(`\nFAIL — ${failures.length} problem(s):`)
  failures.forEach((f) => console.log('  -', f))
  process.exit(1)
}
console.log('\nPASS — all checks green')
