import { Html } from '@react-three/drei'
import { useStore } from '../store'
import { LEVEL_Y, dateToX, laneToZ } from '../config'

/** Floating name tag at the head of each branch lane, so the depth axis is
 *  self-describing without opening the filters panel. */
export function BranchLabels() {
  const branches = useStore((s) => s.branches)
  const nodes = useStore((s) => s.nodes)

  return (
    <group>
      {Object.values(branches).map((b) => {
        const xs = Object.values(nodes)
          .filter((n) => n.branchId === b.id)
          .map((n) => dateToX(n.time) + n.offset.x)
        if (xs.length === 0) return null
        const x = Math.min(...xs) - 7
        return (
          <Html
            key={b.id}
            position={[x, LEVEL_Y.project + 0.4, laneToZ(b.lane)]}
            distanceFactor={34}
            pointerEvents="none"
          >
            <div className="branch-label" style={{ borderColor: b.color, color: b.color }}>
              {b.name}
            </div>
          </Html>
        )
      })}
    </group>
  )
}
