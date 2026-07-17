import { Html, Line } from '@react-three/drei'
import { LEVEL_ORDER, LEVEL_Y, LEVEL_LABEL, LEVEL_BLURB } from '../config'
import { useStore } from '../store'

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
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
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
