import { useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStore } from '../store'
import { matches } from '../lib/layout'
import { LEVEL_Y, dateToX, laneToZ } from '../config'
import { LevelPlanes } from './LevelPlanes'
import { TimeGrid } from './TimeGrid'
import { Edges } from './Edges'
import { NodeMesh } from './NodeMesh'

interface DragState {
  id: string
  baseX: number
  baseZ: number
  y: number
  offsetY: number
  moved: boolean
}

export function Scene() {
  const nodes = useStore((s) => s.nodes)
  const filters = useStore((s) => s.filters)
  const select = useStore((s) => s.select)
  const cancelLinking = useStore((s) => s.cancelLinking)
  const moveNode = useStore((s) => s.moveNode)

  const controls = useRef<OrbitControlsImpl>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const beginDrag = (id: string) => {
    const n = useStore.getState().nodes[id]
    if (!n) return
    const branch = useStore.getState().branches[n.branchId]
    setDrag({
      id,
      baseX: dateToX(n.time),
      baseZ: laneToZ(branch?.lane ?? 0),
      y: LEVEL_Y[n.level],
      offsetY: n.offset.y,
      moved: false,
    })
    if (controls.current) controls.current.enabled = false
  }

  const endDrag = () => {
    if (drag && !drag.moved) select(drag.id)
    setDrag(null)
    if (controls.current) controls.current.enabled = true
    document.body.style.cursor = 'auto'
  }

  const nodeList = Object.values(nodes).filter((n) => {
    if (filters.hideNonMatching) return matches(n, filters)
    return true
  })

  return (
    <Canvas
      camera={{ position: [26, 22, 34], fov: 50, near: 0.1, far: 1000 }}
      onPointerMissed={() => {
        select(null)
        cancelLinking()
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#0e1119']} />
      <fog attach="fog" args={['#0e1119', 80, 200]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[20, 40, 20]} intensity={1.1} />
      <directionalLight position={[-30, 20, -20]} intensity={0.4} color="#8b9dff" />

      <LevelPlanes />
      <TimeGrid />
      <Edges />

      {nodeList.map((n) => (
        <NodeMesh key={n.id} node={n} matched={matches(n, filters)} onBeginDrag={beginDrag} />
      ))}

      {/* Invisible plane that captures pointer motion while dragging a node. */}
      {drag && (
        <mesh
          position={[0, drag.y + drag.offsetY, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            e.stopPropagation()
            const nx = e.point.x - drag.baseX
            const nz = e.point.z - drag.baseZ
            if (!drag.moved) setDrag({ ...drag, moved: true })
            moveNode(drag.id, { x: nx, y: drag.offsetY, z: nz })
            document.body.style.cursor = 'grabbing'
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            endDrag()
          }}
        >
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      <OrbitControls
        ref={controls}
        makeDefault
        enablePan
        panSpeed={1.1}
        zoomSpeed={1.1}
        minDistance={6}
        maxDistance={160}
        maxPolarAngle={Math.PI * 0.92}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
