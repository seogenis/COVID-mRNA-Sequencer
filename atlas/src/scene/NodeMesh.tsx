import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import { Vector3 } from 'three'
import type { AtlasNode } from '../types'
import { useStore } from '../store'
import { TYPE_COLOR, STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from '../config'
import { nodePosition } from '../lib/layout'

const SIZE: Record<AtlasNode['level'], [number, number, number]> = {
  strategy: [4, 0.5, 2.4],
  project: [3.2, 0.45, 2],
  execution: [2.4, 0.4, 1.6],
}

/** Beyond this camera distance a node renders as a compact chip, not a card. */
const LOD_FAR = 62

interface Props {
  node: AtlasNode
  matched: boolean
  /** directly connected to the current selection */
  neighbor: boolean
  /** some node is selected (context-dim everything unrelated) */
  hasSelection: boolean
  progress?: { done: number; total: number }
  onBeginDrag: (id: string) => void
}

const tmp = new Vector3()

export function NodeMesh({ node, matched, neighbor, hasSelection, progress, onBeginDrag }: Props) {
  const branch = useStore((s) => s.branches[node.branchId])
  const selectedId = useStore((s) => s.selectedId)
  const linkingFrom = useStore((s) => s.linkingFrom)
  const linkKind = useStore((s) => s.linkKind)
  const select = useStore((s) => s.select)
  const addEdge = useStore((s) => s.addEdge)
  const focusNode = useStore((s) => s.focusNode)
  const [hovered, setHovered] = useState(false)
  const [far, setFar] = useState(false)
  const lastCheck = useRef(0)

  const pos = nodePosition(node, branch)
  const size = SIZE[node.level]
  const selected = selectedId === node.id
  const isLinkSource = linkingFrom === node.id
  const opacity = matched ? 1 : 0.12
  const color = TYPE_COLOR[node.type]

  // Throttled distance check drives level-of-detail so a zoomed-out view shows
  // tidy chips instead of a wall of overlapping cards (Desmos-style fluidity).
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime
    if (t - lastCheck.current < 0.15) return
    lastCheck.current = t
    const d = camera.position.distanceTo(tmp.set(pos[0], pos[1], pos[2]))
    const isFar = d > LOD_FAR
    if (isFar !== far) setFar(isFar)
  })

  const showFull = !far || selected || hovered || isLinkSource
  const ctxDim = hasSelection && !selected && !neighbor

  return (
    <group position={pos}>
      <RoundedBox
        args={size}
        radius={0.12}
        smoothness={3}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = linkingFrom ? 'crosshair' : 'grab'
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (linkingFrom && linkingFrom !== node.id) {
            addEdge(linkingFrom, node.id, linkKind)
            select(node.id)
            return
          }
          onBeginDrag(node.id)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          focusNode(node.id)
        }}
      >
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          emissive={selected || isLinkSource || neighbor ? color : '#000000'}
          emissiveIntensity={selected || isLinkSource ? 0.5 : neighbor ? 0.28 : 0}
          roughness={0.45}
          metalness={0.1}
        />
      </RoundedBox>

      {/* selection / link halo */}
      {(selected || isLinkSource || hovered) && (
        <mesh position={[0, -size[1] / 2 - 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[size[0] / 2 + 0.2, size[0] / 2 + 0.45, 48]} />
          <meshBasicMaterial color={isLinkSource ? '#f2c14e' : selected ? '#ffffff' : color} transparent opacity={0.7} />
        </mesh>
      )}

      <Html position={[0, size[1] / 2 + 0.35, 0]} center distanceFactor={26} zIndexRange={[10, 0]} pointerEvents="none">
        {showFull ? (
          <div
            className={`node-card ${matched ? '' : 'dim'} ${selected ? 'sel' : ''} ${neighbor ? 'nbr' : ''} ${ctxDim ? 'ctx-dim' : ''}`}
            style={{ ['--accent' as any]: color }}
          >
            <div className="node-card-top">
              <span
                className="node-status-dot"
                style={{ background: STATUS_COLOR[node.status] }}
                title={STATUS_LABEL[node.status]}
              />
              <span className="node-type-chip">{TYPE_LABEL[node.type]}</span>
              {branch && (
                <span className="node-branch-chip" style={{ color: branch.color }}>
                  {branch.name}
                </span>
              )}
            </div>
            <div className="node-title">{node.title}</div>
            <div className="node-meta">
              {node.owner} · {node.time}
            </div>
            {progress && progress.total > 0 && (
              <div className="node-progress" title={`${progress.done}/${progress.total} sub-items done`}>
                <div className="node-progress-bar">
                  <div className="node-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <span className="node-progress-label">
                  {progress.done}/{progress.total}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            className={`node-mini ${matched ? '' : 'dim'} ${neighbor ? 'nbr' : ''} ${ctxDim ? 'ctx-dim' : ''}`}
            style={{ borderColor: color }}
          >
            <span className="node-status-dot" style={{ background: STATUS_COLOR[node.status] }} />
            <span className="node-mini-title">{node.title}</span>
          </div>
        )}
      </Html>
    </group>
  )
}
