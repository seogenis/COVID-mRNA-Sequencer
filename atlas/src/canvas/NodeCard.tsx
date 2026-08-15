import type { AtlasNode, Status } from '../types'
import { useStore } from '../store'
import { TYPE_COLOR, STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from '../config'
import { CARD_W } from './layout2d'

const NEXT_STATUS: Record<Status, Status> = {
  idea: 'todo',
  todo: 'doing',
  doing: 'done',
  done: 'todo',
  blocked: 'doing',
}

interface Props {
  node: AtlasNode
  x: number
  y: number
  matched: boolean
  neighbor: boolean
  hasSelection: boolean
  dragging: boolean
  progress?: { done: number; total: number }
  onDragStart: (e: React.MouseEvent, id: string) => void
}

export function NodeCard({ node, x, y, matched, neighbor, hasSelection, dragging, progress, onDragStart }: Props) {
  const branch = useStore((s) => s.branches[node.branchId])
  const selectedId = useStore((s) => s.selectedId)
  const linkingFrom = useStore((s) => s.linkingFrom)
  const linkKind = useStore((s) => s.linkKind)
  const select = useStore((s) => s.select)
  const addEdge = useStore((s) => s.addEdge)
  const frameNode = useStore((s) => s.frameNode)
  const updateNode = useStore((s) => s.updateNode)

  const selected = selectedId === node.id
  const isLinkSource = linkingFrom === node.id
  const ctxDim = hasSelection && !selected && !neighbor
  const color = TYPE_COLOR[node.type]

  const cls = [
    'canvas-card',
    matched ? '' : 'dim',
    selected ? 'sel' : '',
    neighbor ? 'nbr' : '',
    ctxDim ? 'ctx-dim' : '',
    isLinkSource ? 'linksrc' : '',
    dragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{
        left: x,
        top: y,
        width: CARD_W,
        // scale is applied by the world container; keep card in world px
        ['--accent' as string]: color,
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation() // don't start a background pan
        // linking mode: this click completes the edge instead of dragging
        if (linkingFrom && linkingFrom !== node.id) {
          addEdge(linkingFrom, node.id, linkKind)
          select(node.id)
          return
        }
        onDragStart(e, node.id)
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (!dragging) select(node.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        frameNode(node.id)
      }}
    >
      <div className="canvas-card-accent" />
      <div className="canvas-card-body">
        <div className="node-card-top">
          <button
            className="node-status-dot clickable"
            style={{ background: STATUS_COLOR[node.status] }}
            title={`${STATUS_LABEL[node.status]} — click to advance`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              const next = NEXT_STATUS[node.status]
              updateNode(node.id, { status: next }, `marked "${node.title}" ${STATUS_LABEL[next]}`)
            }}
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
          {node.owner || 'Unassigned'} · {node.time}
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
    </div>
  )
}
