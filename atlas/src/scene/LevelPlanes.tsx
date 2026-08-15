import { Html, Line } from '@react-three/drei'
import { LEVEL_ORDER, LEVEL_Y, LEVEL_LABEL, LEVEL_BLURB, xToDate, zToLane } from '../config'
import { useStore } from '../store'
import type { Level } from '../types'

const PLANE_W = 260
const PLANE_D = 64

// The four corners of a floor, as a closed loop for the border line.
const FRAME: [number, number, number][] = [
  [-PLANE_W / 2, 0, -PLANE_D / 2],
  [PLANE_W / 2, 0, -PLANE_D / 2],
  [PLANE_W / 2, 0, PLANE_D / 2],
  [-PLANE_W / 2, 0, PLANE_D / 2],
  [-PLANE_W / 2, 0, -PLANE_D / 2],
]

const FLOOR_COLOR = {
  strategy: '#3a3660',
  project: '#2c3a4a',
  execution: '#2a3a34',
} as const

/** Double-clicking an empty spot on a floor creates a node THERE — the click
 *  position maps to (time, branch, altitude), so where you click is what it means. */
function createNodeAt(level: Level, worldX: number, worldZ: number) {
  const { branches, addNode } = useStore.getState()
  const lane = zToLane(worldZ)
  const branch =
    Object.values(branches).reduce<{ id: string; d: number } | null>((best, b) => {
      const d = Math.abs(b.lane - lane)
      return !best || d < best.d ? { id: b.id, d } : best
    }, null)?.id ?? Object.keys(branches)[0]
  const type = level === 'strategy' ? 'strategy' : 'task'
  // addNode selects the new node, so the inspector opens ready to type a title.
  addNode({ level, type, branchId: branch, time: xToDate(worldX), title: 'New node' })
}

export function LevelPlanes() {
  const show = useStore((s) => s.settings.showLevelPlanes)
  const levelsOn = useStore((s) => s.filters.levels)
  if (!show) return null

  return (
    <group>
      {LEVEL_ORDER.map((level) => {
        const y = LEVEL_Y[level]
        const on = levelsOn[level]
        return (
          <group key={level} position={[0, y, 0]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.02, 0]}
              onDoubleClick={(e) => {
                e.stopPropagation()
                createNodeAt(level, e.point.x, e.point.z)
              }}
            >
              <planeGeometry args={[PLANE_W, PLANE_D]} />
              <meshBasicMaterial color={FLOOR_COLOR[level]} transparent opacity={on ? 0.16 : 0.04} depthWrite={false} />
            </mesh>
            <Line points={FRAME} color="#4a5268" lineWidth={1} transparent opacity={on ? 0.55 : 0.15} />
            <Html
              position={[-PLANE_W / 2 + 3, 0.3, -PLANE_D / 2 + 4]}
              distanceFactor={44}
              occlude={false}
              pointerEvents="none"
            >
              <div className={`level-tag ${on ? '' : 'muted'}`}>
                <div className="level-tag-name">{LEVEL_LABEL[level]}</div>
                <div className="level-tag-blurb">{LEVEL_BLURB[level]}</div>
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
