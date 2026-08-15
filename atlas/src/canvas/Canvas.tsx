import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { matches } from '../lib/layout'
import { LEVEL_LABEL } from '../config'
import { computeLayout, computeGroupedLayout, levelAtY, timeToX, xToTime, type GroupedLayout } from './layout2d'
import { EdgeLayer } from './EdgeLayer'
import { NodeCard } from './NodeCard'

const MIN_SCALE = 0.3
const MAX_SCALE = 1.8

const BAND_TINT: Record<string, string> = {
  strategy: 'rgba(139,124,255,0.05)',
  project: 'rgba(90,169,230,0.04)',
  execution: 'rgba(75,208,160,0.045)',
}
const BAND_DOT: Record<string, string> = {
  strategy: '#8b7cff',
  project: '#5aa9e6',
  execution: '#4bd0a0',
}

interface Interaction {
  kind: 'pan' | 'drag'
  startClientX: number
  startClientY: number
  startPanX: number
  startPanY: number
  id?: string
  grabDX?: number
  grabDY?: number
  lastX?: number
  lastY?: number
  moved: boolean
}

export function Canvas() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const branches = useStore((s) => s.branches)
  const filters = useStore((s) => s.filters)
  const layoutMode = useStore((s) => s.layoutMode)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const cancelLinking = useStore((s) => s.cancelLinking)
  const placeNode = useStore((s) => s.placeNode)
  const addNode = useStore((s) => s.addNode)
  const frameRequest = useStore((s) => s.frameRequest)
  const clearFrame = useStore((s) => s.clearFrame)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 220, y: 120 })
  const [scale, setScale] = useState(0.75)
  const panRef = useRef(pan)
  const scaleRef = useRef(scale)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const interaction = useRef<Interaction | null>(null)
  const animRef = useRef<number | null>(null)
  const didInitialFit = useRef(false)

  const applyView = (px: number, py: number, s: number) => {
    panRef.current = { x: px, y: py }
    scaleRef.current = s
    setPan({ x: px, y: py })
    setScale(s)
  }

  const layout = useMemo(
    () =>
      layoutMode === 'grouped'
        ? computeGroupedLayout(Object.values(nodes), branches)
        : computeLayout(Object.values(nodes)),
    [nodes, branches, layoutMode],
  )

  const nodeList = useMemo(
    () => Object.values(nodes).filter((n) => (filters.hideNonMatching ? matches(n, filters) : true)),
    [nodes, filters],
  )
  const matchedSet = useMemo(() => {
    const s = new Set<string>()
    for (const n of Object.values(nodes)) if (matches(n, filters)) s.add(n.id)
    return s
  }, [nodes, filters])

  const neighbors = useMemo(() => {
    if (!selectedId) return null
    const set = new Set<string>()
    for (const e of Object.values(edges)) {
      if (e.from === selectedId) set.add(e.to)
      if (e.to === selectedId) set.add(e.from)
    }
    return set
  }, [edges, selectedId])

  const progress = useMemo(() => {
    const map: Record<string, { done: number; total: number }> = {}
    for (const e of Object.values(edges)) {
      if (e.kind !== 'hierarchy') continue
      const child = nodes[e.to]
      if (!child) continue
      const p = (map[e.from] ??= { done: 0, total: 0 })
      p.total += 1
      if (child.status === 'done') p.done += 1
    }
    return map
  }, [edges, nodes])

  const posOf = (id: string) => (drag && drag.id === id ? { x: drag.x, y: drag.y } : layout.pos[id])

  const screenToWorld = (clientX: number, clientY: number, p = panRef.current, s = scaleRef.current) => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - p.x) / s, y: (clientY - rect.top - p.y) / s }
  }

  // ---- frame animation ----
  const animateTo = (targetPan: { x: number; y: number }, targetScale: number) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    const sp = { ...panRef.current }
    const ss = scaleRef.current
    const dur = 360
    let start = -1
    const stepFn = (now: number) => {
      if (start < 0) start = now
      const t = Math.min(1, (now - start) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      applyView(sp.x + (targetPan.x - sp.x) * e, sp.y + (targetPan.y - sp.y) * e, ss + (targetScale - ss) * e)
      if (t < 1) animRef.current = requestAnimationFrame(stepFn)
      else animRef.current = null
    }
    animRef.current = requestAnimationFrame(stepFn)
  }

  // Chrome insets so content frames inside the visible area, clear of the
  // floating side panel (left), inspector (right, when open), toolbar + month rail.
  const insets = () => ({
    left: 250,
    right: selectedId ? 360 : 32,
    top: 72,
    bottom: 48,
  })

  const fitAll = () => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const ins = insets()
    const availW = Math.max(200, rect.width - ins.left - ins.right)
    const availH = Math.max(200, rect.height - ins.top - ins.bottom)
    const pad = 70
    const w = Math.max(400, layout.maxX - layout.minX) + pad * 2
    const h = Math.max(300, layout.totalHeight) + pad * 2
    const ts = Math.max(MIN_SCALE, Math.min(1.1, Math.min(availW / w, availH / h)))
    const cx = (layout.minX + layout.maxX) / 2
    const cy = layout.totalHeight / 2
    animateTo({ x: ins.left + availW / 2 - cx * ts, y: ins.top + availH / 2 - cy * ts }, ts)
  }

  const focusOne = (id: string) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const p = layout.pos[id]
    if (!rect || !p) return
    const ins = insets()
    const ts = Math.max(scaleRef.current, 0.85)
    const availW = Math.max(200, rect.width - ins.left - ins.right)
    const availH = Math.max(200, rect.height - ins.top - ins.bottom)
    animateTo({ x: ins.left + availW / 2 - p.x * ts, y: ins.top + availH / 2 - p.y * ts }, ts)
  }

  useEffect(() => {
    if (!frameRequest) return
    if (frameRequest.kind === 'all') fitAll()
    else focusOne(frameRequest.id)
    clearFrame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest])

  useEffect(() => {
    if (didInitialFit.current) return
    didInitialFit.current = true
    const t = setTimeout(fitAll, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // refit when switching layout mode
  useEffect(() => {
    if (!didInitialFit.current) return
    const t = setTimeout(fitAll, 20)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode])

  // ---- wheel zoom to cursor ----
  const onWheel = (e: React.WheelEvent) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    const rect = viewportRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const s = scaleRef.current
    const p = panRef.current
    const factor = Math.exp(-e.deltaY * 0.0015)
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * factor))
    const wx = (cx - p.x) / s
    const wy = (cy - p.y) / s
    applyView(cx - wx * ns, cy - wy * ns, ns)
  }

  // ---- pan + drag via mouse events (universally dispatched) ----
  const lastMoved = useRef(false)

  const beginInteraction = (it: Interaction) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    interaction.current = it
    const move = (ev: MouseEvent) => handleMoveLogic(ev.clientX, ev.clientY)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      handleEndLogic()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onViewportMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    beginInteraction({
      kind: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
      moved: false,
    })
    document.body.style.cursor = 'grabbing'
  }

  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    const w = screenToWorld(e.clientX, e.clientY)
    const c = layout.pos[id] ?? { x: w.x, y: w.y }
    beginInteraction({
      kind: 'drag',
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
      grabDX: w.x - c.x,
      grabDY: w.y - c.y,
      moved: false,
    })
  }

  const handleMoveLogic = (clientX: number, clientY: number) => {
    const it = interaction.current
    if (!it) return
    const dx = clientX - it.startClientX
    const dy = clientY - it.startClientY
    if (!it.moved && Math.hypot(dx, dy) > 4) it.moved = true
    if (it.kind === 'pan') {
      applyView(it.startPanX + dx, it.startPanY + dy, scaleRef.current)
    } else if (it.kind === 'drag' && it.id) {
      const w = screenToWorld(clientX, clientY, { x: it.startPanX, y: it.startPanY })
      const nx = w.x - (it.grabDX ?? 0)
      const ny = w.y - (it.grabDY ?? 0)
      it.lastX = nx
      it.lastY = ny
      setDrag({ id: it.id, x: nx, y: ny })
    }
  }

  const handleEndLogic = () => {
    const it = interaction.current
    if (!it) return
    if (it.kind === 'drag' && it.id && it.moved && it.lastX != null && it.lastY != null) {
      // In grouped mode x is structural, not time — keep the node's date, only
      // let the vertical drop change its altitude.
      const time = layoutMode === 'timeline' ? xToTime(it.lastX) : (nodes[it.id]?.time ?? xToTime(it.lastX))
      placeNode(it.id, time, levelAtY(it.lastY, layout.bands))
    }
    lastMoved.current = it.moved
    document.body.style.cursor = ''
    setDrag(null)
    interaction.current = null
  }

  const onViewportClick = () => {
    if (lastMoved.current) {
      lastMoved.current = false
      return
    }
    select(null)
    cancelLinking()
  }

  const onViewportDoubleClick = (e: React.MouseEvent) => {
    const w = screenToWorld(e.clientX, e.clientY)
    const level = levelAtY(w.y, layout.bands)
    const type = level === 'strategy' ? 'strategy' : 'task'
    // grouped mode ignores x-as-time, so a new node just takes today's date
    addNode({ level, type, time: layoutMode === 'timeline' ? xToTime(w.x) : undefined, title: 'New node' })
  }

  const worldStyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }

  const bgLeft = layout.minX - 800
  const bgWidth = layout.maxX - layout.minX + 1600
  const columns = layoutMode === 'grouped' && 'columns' in layout ? (layout as GroupedLayout).columns : []

  const months = useMemo(() => {
    const out: { iso: string; label: string; x: number; year: boolean }[] = []
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let y = 2025; y <= 2027; y++)
      for (let m = 0; m < 12; m++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`
        out.push({ iso, label: m === 0 ? `${names[m]} ${y}` : names[m], x: timeToX(iso), year: m === 0 })
      }
    return out
  }, [])
  const nowX = timeToX(new Date().toISOString().slice(0, 10))

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      onWheel={onWheel}
      onMouseDown={onViewportMouseDown}
      onClick={onViewportClick}
      onDoubleClick={onViewportDoubleClick}
    >
      <div className="canvas-world" style={worldStyle}>
        {/* altitude bands */}
        {layout.bands.map((b, i) => (
          <div
            key={b.level}
            className="canvas-band"
            style={{ left: bgLeft, top: b.top, width: bgWidth, height: b.height, background: BAND_TINT[b.level] }}
          >
            {i > 0 && <div className="canvas-band-sep" />}
          </div>
        ))}
        {/* month gridlines + NOW (timeline mode only) */}
        {layoutMode === 'timeline' &&
          months.map((m) => (
            <div
              key={m.iso}
              className={`canvas-gridline ${m.year ? 'year' : ''}`}
              style={{ left: m.x, top: 0, height: layout.totalHeight }}
            />
          ))}
        {layoutMode === 'timeline' && (
          <div className="canvas-now" style={{ left: nowX, top: -10, height: layout.totalHeight + 20 }} />
        )}

        <EdgeLayer
          edges={Object.values(edges)}
          pos={posOf}
          matched={matchedSet}
          selectedId={selectedId}
          hideNonMatching={filters.hideNonMatching}
        />

        {nodeList.map((n) => {
          const p = posOf(n.id)
          if (!p) return null
          return (
            <NodeCard
              key={n.id}
              node={n}
              x={p.x}
              y={p.y}
              matched={matchedSet.has(n.id)}
              neighbor={neighbors?.has(n.id) ?? false}
              hasSelection={selectedId !== null}
              dragging={drag?.id === n.id}
              progress={progress[n.id]}
              onDragStart={startNodeDrag}
            />
          )
        })}
      </div>

      {/* branch column labels (grouped mode) */}
      {columns.length > 0 && (
        <div className="branch-cols">
          {columns.map((c) => {
            const b = branches[c.id]
            if (!b) return null
            return (
              <div
                key={c.id}
                className="branch-col-label"
                style={{
                  left: (c.start + c.width / 2) * scale + pan.x,
                  top: layout.bands[0].top * scale + pan.y - 4,
                  color: b.color,
                  borderColor: b.color,
                }}
              >
                {b.name}
              </div>
            )
          })}
        </div>
      )}

      {/* band headers (screen-space, pinned left, follow vertical pan) */}
      <div className="band-headers">
        {layout.bands.map((b) => (
          <div key={b.level} className="band-header" style={{ top: b.top * scale + pan.y + 12 }}>
            <span className="band-header-dot" style={{ background: BAND_DOT[b.level] }} />
            {LEVEL_LABEL[b.level]}
          </div>
        ))}
      </div>

      {/* month labels + NOW (screen-space, pinned bottom) — timeline mode only */}
      {layoutMode === 'timeline' && (
        <div className="month-labels">
          {months.map((m) => (
            <div key={m.iso} className={`month-label ${m.year ? 'year' : ''}`} style={{ left: m.x * scale + pan.x }}>
              {m.label}
            </div>
          ))}
          <div className="now-flag" style={{ left: nowX * scale + pan.x }}>
            NOW
          </div>
        </div>
      )}
    </div>
  )
}
