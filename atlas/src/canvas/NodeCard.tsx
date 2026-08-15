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
  const typeColor = TYPE_COLOR[node.type]
  const branchColor = branch?.color ?? '#5b6478'

  const cls = [
    'canvas-card',
    matched ? '' : 'dim',
    selected ? 'sel' : '',
    neighbor ? 'nbr' : '',
    ctxDim ? 'ctx-dim' : '',
    isLinkSource ? 'linksrc' : '',
    dragging ? 'dragging' : '',
    `st-${node.status}`,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{ left: x, top: y, width: CARD_W, ['--branch' as string]: branchColor }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
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
      <div className="cc-top">
        <button
          className="cc-status"
          style={{ background: STATUS_COLOR[node.status] }}
          title={`${STATUS_LABEL[node.status]} — click to advance`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const next = NEXT_STATUS[node.status]
            updateNode(node.id, { status: next }, `marked "${node.title}" ${STATUS_LABEL[next]}`)
          }}
        />
        <span className="cc-type" style={{ color: typeColor }}>
          {TYPE_LABEL[node.type]}
        </span>
        <span className="cc-date">{node.time.slice(5)}</span>
      </div>

      <div className="cc-title">{node.title}</div>

      {progress && progress.total > 0 && (
        <div className="cc-progress" title={`${progress.done}/${progress.total} done`}>
          <div className="cc-progress-track">
            <div className="cc-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="cc-progress-num">
            {progress.done}/{progress.total}
          </span>
        </div>
      )}

      <div className="cc-foot">
        <span className="cc-avatar" style={{ borderColor: branchColor, color: branchColor }}>
          {(node.owner || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="cc-owner">{node.owner || 'Unassigned'}</span>
        {branch && <span className="cc-branch">{branch.name}</span>}
      </div>
    </div>
  )
}
