import type { AtlasEdge } from '../types'
import { EDGE_COLOR } from '../config'

interface Props {
  edges: AtlasEdge[]
  pos: (id: string) => { x: number; y: number } | undefined
  matched: Set<string>
  selectedId: string | null
  hideNonMatching: boolean
}

// One SVG in world space behind the cards. overflow:visible lets paths render
// at negative / large coordinates without a fixed viewBox.
export function EdgeLayer({ edges, pos, matched, selectedId, hideNonMatching }: Props) {
  const hasSel = selectedId !== null
  return (
    <svg className="edge-layer" width="1" height="1" style={{ overflow: 'visible' }}>
      {edges.map((e) => {
        const a = pos(e.from)
        const b = pos(e.to)
        if (!a || !b) return null
        const bothMatch = matched.has(e.from) && matched.has(e.to)
        if (hideNonMatching && !bothMatch) return null

        const active = selectedId === e.from || selectedId === e.to
        // horizontal-ish S-curve; steeper control offset when spanning bands
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
        const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
        const opacity = active ? 0.95 : hasSel ? 0.07 : bothMatch ? 0.28 : 0.08
        return (
          <path
            key={e.id}
            d={d}
            fill="none"
            stroke={EDGE_COLOR[e.kind]}
            strokeWidth={active ? 2.2 : 1.3}
            strokeDasharray={e.kind === 'hierarchy' ? undefined : '5 5'}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}
