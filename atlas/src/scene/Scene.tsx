import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Vector3, Box3 } from 'three'
import { useStore } from '../store'
import { matches, nodePosition } from '../lib/layout'
import { LEVEL_Y, dateToX, laneToZ } from '../config'
import { LevelPlanes } from './LevelPlanes'
import { TimeGrid } from './TimeGrid'
import { Edges } from './Edges'
import { NodeMesh } from './NodeMesh'
import { BranchLabels } from './BranchLabels'

/** Smoothly flies the camera to frame a node or the whole graph on request. */
function CameraRig() {
  const three = useThree()
  const frameRequest = useStore((s) => s.frameRequest)
  const clearFrame = useStore((s) => s.clearFrame)
  const anim = useRef<{ pos: Vector3; look: Vector3 } | null>(null)

  useEffect(() => {
    if (!frameRequest) return
    const { nodes, branches } = useStore.getState()
    const dir = new Vector3(1, 0.7, 1.4).normalize()
    if (frameRequest.kind === 'node') {
      const n = nodes[frameRequest.id]
      if (n) {
        const p = nodePosition(n, branches[n.branchId])
        const look = new Vector3(p[0], p[1], p[2])
        anim.current = { look, pos: look.clone().add(dir.clone().multiplyScalar(20)) }
      }
    } else {
      const list = Object.values(nodes)
      if (list.length === 0) {
        anim.current = { look: new Vector3(0, 0, 0), pos: dir.clone().multiplyScalar(60) }
      } else {
        const box = new Box3()
        for (const n of list) {
          const p = nodePosition(n, branches[n.branchId])
          box.expandByPoint(new Vector3(p[0], p[1], p[2]))
        }
        const center = box.getCenter(new Vector3())
        const size = box.getSize(new Vector3())
        const dist = Math.max(size.length() * 0.65, 30) + 12
        anim.current = { look: center, pos: center.clone().add(dir.clone().multiplyScalar(dist)) }
      }
    }
    clearFrame()
  }, [frameRequest, clearFrame])

  useFrame(() => {
    const a = anim.current
    if (!a) return
    const controls = three.controls as unknown as { target: Vector3; update: () => void } | null
    three.camera.position.lerp(a.pos, 0.12)
    if (controls?.target) {
      controls.target.lerp(a.look, 0.12)
      controls.update()
    }
    if (three.camera.position.distanceTo(a.pos) < 0.4) {
      three.camera.position.copy(a.pos)
      if (controls?.target) {
        controls.target.copy(a.look)
        controls.update()
      }
      anim.current = null
    }
  })
  return null
}

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
  const edges = useStore((s) => s.edges)
  const filters = useStore((s) => s.filters)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const cancelLinking = useStore((s) => s.cancelLinking)
  const moveNode = useStore((s) => s.moveNode)

  const controls = useRef<OrbitControlsImpl>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // Nodes directly connected to the selection — highlighted so the "why does
  // this matter" context reads instantly.
  const neighbors = useMemo(() => {
    if (!selectedId) return null
    const set = new Set<string>()
    for (const e of Object.values(edges)) {
      if (e.from === selectedId) set.add(e.to)
      if (e.to === selectedId) set.add(e.from)
    }
    return set
  }, [edges, selectedId])

  // Per-parent rollup of direct hierarchy children: the strategy floor shows
  // live progress of the execution floor.
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

      <CameraRig />
      <LevelPlanes />
      <TimeGrid />
      <BranchLabels />
      <Edges />

      {nodeList.map((n) => (
        <NodeMesh
          key={n.id}
          node={n}
          matched={matches(n, filters)}
          neighbor={neighbors?.has(n.id) ?? false}
          hasSelection={selectedId !== null}
          progress={progress[n.id]}
          onBeginDrag={beginDrag}
        />
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
