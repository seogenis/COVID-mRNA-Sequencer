import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { matches } from '../lib/layout'
import { LEVEL_LABEL, LEVEL_BLURB } from '../config'
import {
  LEVELS,
  BAND_H,
  bandTop,
  bandCenterY,
  yToLevel,
  nodeXY,
  timeToX,
  xToTime,
  clampBandOffset,
  CANVAS_BOTTOM,
  CARD_W,
  CARD_H,
} from './layout2d'
import { EdgeLayer } from './EdgeLayer'
import { NodeCard } from './NodeCard'

const MIN_SCALE = 0.25
const MAX_SCALE = 2.2
const WORLD_MIN_X = -2600
const WORLD_MAX_X = 8000

const BAND_TINT: Record<string, string> = {
  strategy: 'rgba(58,54,96,0.16)',
  project: 'rgba(44,58,74,0.16)',
  execution: 'rgba(42,58,52,0.16)',
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
  const filters = useStore((s) => s.filters)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const cancelLinking = useStore((s) => s.cancelLinking)
  const placeNode = useStore((s) => s.placeNode)
  const addNode = useStore((s) => s.addNode)
  const frameRequest = useStore((s) => s.frameRequest)
  const clearFrame = useStore((s) => s.clearFrame)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 200, y: 90 })
  const [scale, setScale] = useState(0.75)
  // refs mirror pan/scale for synchronous reads inside rAF + pointer handlers
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

  // world position of a node (live position if it's the one being dragged)
  const posOf = (id: string) => {
    if (drag && drag.id === id) return { x: drag.x, y: drag.y }
    const n = nodes[id]
    return n ? nodeXY(n) : undefined
  }

  const screenToWorld = (clientX: number, clientY: number, p = panRef.current, s = scaleRef.current) => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - p.x) / s, y: (clientY - rect.top - p.y) / s }
  }

  // ---- frame animation (fit all / focus one) — time-based easeOutCubic ----
  const animateTo = (targetPan: { x: number; y: number }, targetScale: number) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    const sp = { ...panRef.current }
    const ss = scaleRef.current
    const dur = 360
    let start = -1
    const step = (now: number) => {
      if (start < 0) start = now
      const t = Math.min(1, (now - start) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      applyView(sp.x + (targetPan.x - sp.x) * e, sp.y + (targetPan.y - sp.y) * e, ss + (targetScale - ss) * e)
      if (t < 1) animRef.current = requestAnimationFrame(step)
      else animRef.current = null
    }
    animRef.current = requestAnimationFrame(step)
  }

  const fitAll = () => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const list = Object.values(nodes)
    if (list.length === 0) {
      animateTo({ x: rect.width / 2, y: rect.height / 3 }, 0.8)
      return
    }
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const n of list) {
      const { x, y } = nodeXY(n)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const pad = 120
    const w = maxX - minX + CARD_W + pad * 2
    const h = maxY - minY + CARD_H + pad * 2
    const ts = Math.max(MIN_SCALE, Math.min(1.1, Math.min(rect.width / w, rect.height / h)))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    animateTo({ x: rect.width / 2 - cx * ts, y: rect.height / 2 - cy * ts }, ts)
  }

  const focusOne = (id: string) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const n = nodes[id]
    if (!rect || !n) return
    const { x, y } = nodeXY(n)
    const ts = Math.max(scaleRef.current, 0.9)
    animateTo({ x: rect.width / 2 - x * ts, y: rect.height / 2 - y * ts }, ts)
  }

  // consume frame requests from the store (outline click, ⤢ Frame all, search)
  useEffect(() => {
    if (!frameRequest) return
    if (frameRequest.kind === 'all') fitAll()
    else focusOne(frameRequest.id)
    clearFrame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest])

  // fit once on first mount after layout is known
  useEffect(() => {
    if (didInitialFit.current) return
    didInitialFit.current = true
    const t = setTimeout(fitAll, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // keep the world point under the cursor fixed
    const wx = (cx - p.x) / s
    const wy = (cy - p.y) / s
    applyView(cx - wx * ns, cy - wy * ns, ns)
  }

  // Dragging + panning use MOUSE events with per-interaction window listeners.
  // (Mouse events are dispatched by every browser AND by automated harnesses;
  // pointer events aren't always synthesised, which made drags untestable.)
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

  // called by NodeCard on mousedown
  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    const w = screenToWorld(e.clientX, e.clientY)
    const c = nodeXY(nodes[id])
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
      const level = yToLevel(it.lastY)
      placeNode(it.id, xToTime(it.lastX), level, clampBandOffset(it.lastY - bandCenterY(level)))
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
    const level = yToLevel(w.y)
    const type = level === 'strategy' ? 'strategy' : 'task'
    addNode({ level, type, time: xToTime(w.x), title: 'New node' })
  }

  const worldStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transformOrigin: '0 0',
  }

  // month gridlines within the visible-ish range
  const months = useMemo(() => {
    const out: { iso: string; label: string; x: number }[] = []
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let y = 2025; y <= 2027; y++)
      for (let m = 0; m < 12; m++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`
        out.push({ iso, label: `${names[m]}${m === 0 ? " '" + String(y).slice(2) : ''}`, x: timeToX(iso) })
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
        {LEVELS.map((level) => (
          <div
            key={level}
            className="canvas-band"
            style={{
              left: WORLD_MIN_X,
              top: bandTop(level),
              width: WORLD_MAX_X - WORLD_MIN_X,
              height: BAND_H,
              background: BAND_TINT[level],
            }}
          />
        ))}
        {/* month gridlines */}
        {months.map((m) => (
          <div key={m.iso} className="canvas-gridline" style={{ left: m.x, top: 0, height: CANVAS_BOTTOM }} />
        ))}
        {/* NOW line */}
        <div className="canvas-now" style={{ left: nowX, top: -20, height: CANVAS_BOTTOM + 40 }} />

        <EdgeLayer
          edges={Object.values(edges)}
          pos={posOf}
          matched={matchedSet}
          selectedId={selectedId}
          hideNonMatching={filters.hideNonMatching}
        />

        {nodeList.map((n) => {
          const p = posOf(n.id)!
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

      {/* screen-space band labels (left gutter) */}
      <div className="band-labels">
        {LEVELS.map((level) => (
          <div key={level} className="band-label" style={{ top: bandCenterY(level) * scale + pan.y }}>
            <div className="band-label-name">{LEVEL_LABEL[level]}</div>
            <div className="band-label-blurb">{LEVEL_BLURB[level]}</div>
          </div>
        ))}
      </div>

      {/* screen-space month labels (bottom) + NOW */}
      <div className="month-labels">
        {months.map((m) => (
          <div key={m.iso} className="month-label" style={{ left: m.x * scale + pan.x }}>
            {m.label}
          </div>
        ))}
        <div className="now-flag" style={{ left: nowX * scale + pan.x }}>
          NOW
        </div>
      </div>
    </div>
  )
}
