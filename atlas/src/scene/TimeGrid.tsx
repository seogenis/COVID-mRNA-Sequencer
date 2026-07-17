import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import { dateToX, LEVEL_Y } from '../config'
import { useStore } from '../store'

const TOP = LEVEL_Y.strategy + 4
const BOTTOM = LEVEL_Y.execution - 4
const DEPTH = 60

function monthList(): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = []
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  for (let y = 2025; y <= 2027; y++) {
    for (let m = 0; m < 12; m++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`
      out.push({ iso, label: `${names[m]}${m === 0 ? " '" + String(y).slice(2) : ''}` })
    }
  }
  return out
}

export function TimeGrid() {
  const show = useStore((s) => s.settings.showTimeGrid)
  const months = useMemo(monthList, [])
  const todayX = useMemo(() => dateToX(new Date().toISOString().slice(0, 10)), [])
  if (!show) return null

  return (
    <group>
      {months.map((m) => {
        const x = dateToX(m.iso)
        return (
          <group key={m.iso}>
            <Line
              points={[
                [x, BOTTOM, -DEPTH / 2],
                [x, BOTTOM, DEPTH / 2],
              ]}
              color="#333a4a"
              lineWidth={1}
              transparent
              opacity={0.5}
            />
            <Html position={[x, BOTTOM - 0.5, DEPTH / 2]} distanceFactor={46} pointerEvents="none">
              <div className="month-label">{m.label}</div>
            </Html>
          </group>
        )
      })}

      {/* NOW plane — a translucent wall at today's date, spanning all altitudes. */}
      <mesh position={[todayX, (TOP + BOTTOM) / 2, 0]}>
        <planeGeometry args={[0.15, TOP - BOTTOM]} />
        <meshBasicMaterial color="#f2c14e" transparent opacity={0.5} />
      </mesh>
      <Html position={[todayX, TOP + 0.6, 0]} distanceFactor={40} pointerEvents="none">
        <div className="now-label">NOW</div>
      </Html>
    </group>
  )
}
