import { Line } from '@react-three/drei'
import { useStore } from '../store'
import { nodePosition, matches } from '../lib/layout'
import { EDGE_COLOR } from '../config'

export function Edges() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const branches = useStore((s) => s.branches)
  const filters = useStore((s) => s.filters)
  const selectedId = useStore((s) => s.selectedId)

  return (
    <group>
      {Object.values(edges).map((e) => {
        const a = nodes[e.from]
        const b = nodes[e.to]
        if (!a || !b) return null

        const aMatch = matches(a, filters)
        const bMatch = matches(b, filters)
        if (filters.hideNonMatching && (!aMatch || !bMatch)) return null

        const pa = nodePosition(a, branches[a.branchId])
        const pb = nodePosition(b, branches[b.branchId])
        const touchesSelection = selectedId === e.from || selectedId === e.to
        const dim = !aMatch || !bMatch
        const opacity = touchesSelection ? 0.95 : dim ? 0.12 : 0.42

        return (
          <Line
            key={e.id}
            points={[pa, pb]}
            color={EDGE_COLOR[e.kind]}
            lineWidth={touchesSelection ? 2.4 : 1.4}
            transparent
            opacity={opacity}
            dashed={e.kind !== 'hierarchy'}
            dashSize={0.7}
            gapSize={0.5}
          />
        )
      })}
    </group>
  )
}
