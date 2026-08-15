import type { AtlasEdge } from '../types'
import { EDGE_COLOR } from '../config'

interface Props {
  edges: AtlasEdge[]
  pos: (id: string) => { x: number; y: number } | undefined
  matched: Set<string>
  selectedId: string | null
  hideNonMatching: boolean
}

// One big SVG in world space behind the cards. overflow:visible lets paths
// render at negative / large coordinates without a fixed viewBox.
export function EdgeLayer({ edges, pos, matched, selectedId, hideNonMatching }: Props) {
  return (
    <svg className="edge-layer" width="1" height="1" style={{ overflow: 'visible' }}>
      {edges.map((e) => {
        const a = pos(e.from)
        const b = pos(e.to)
        if (!a || !b) return null
        const bothMatch = matched.has(e.from) && matched.has(e.to)
        if (hideNonMatching && !bothMatch) return null

        const touchesSel = selectedId === e.from || selectedId === e.to
        const mx = (a.x + b.x) / 2
        const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
        const opacity = touchesSel ? 0.95 : bothMatch ? 0.4 : 0.1
        return (
          <path
            key={e.id}
            d={d}
            fill="none"
            stroke={EDGE_COLOR[e.kind]}
            strokeWidth={touchesSel ? 2.4 : 1.4}
            strokeDasharray={e.kind === 'hierarchy' ? undefined : '6 5'}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}
