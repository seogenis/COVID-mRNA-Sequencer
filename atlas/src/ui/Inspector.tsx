import { useState } from 'react'
import { useStore } from '../store'
import type { NodeType, Level, Status, EdgeKind } from '../types'
import { TYPE_LABEL, LEVEL_LABEL, LEVEL_ORDER, STATUS_LABEL, EDGE_LABEL } from '../config'
import { renderMarkdown } from '../lib/markdown'

const TYPES: NodeType[] = ['strategy', 'task', 'info', 'question', 'decision']
const STATUSES: Status[] = ['idea', 'todo', 'doing', 'blocked', 'done']
const LINK_KINDS: EdgeKind[] = ['hierarchy', 'depends', 'relates']

export function Inspector() {
  const selectedId = useStore((s) => s.selectedId)
  const node = useStore((s) => (s.selectedId ? s.nodes[s.selectedId] : null))
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const branches = useStore((s) => s.branches)
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const startLinking = useStore((s) => s.startLinking)
  const deleteEdge = useStore((s) => s.deleteEdge)
  const select = useStore((s) => s.select)
  const [preview, setPreview] = useState(false)

  if (!selectedId || !node) return null

  const connections = Object.values(edges).filter((e) => e.from === selectedId || e.to === selectedId)

  return (
    <div className="inspector">
      <div className="panel-head">
        <span>Node</span>
        <button className="link" onClick={() => select(null)}>
          close ✕
        </button>
      </div>

      <div className="insp-body">
        <input
          className="insp-title"
          value={node.title}
          onChange={(e) => updateNode(node.id, { title: e.target.value })}
        />

        <div className="insp-grid">
          <label>
            Altitude
            <select value={node.level} onChange={(e) => updateNode(node.id, { level: e.target.value as Level })}>
              {LEVEL_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={node.type} onChange={(e) => updateNode(node.id, { type: e.target.value as NodeType })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={node.status} onChange={(e) => updateNode(node.id, { status: e.target.value as Status })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select value={node.branchId} onChange={(e) => updateNode(node.id, { branchId: e.target.value })}>
              {Object.values(branches).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <input value={node.owner} onChange={(e) => updateNode(node.id, { owner: e.target.value })} />
          </label>
          <label>
            Date
            <input type="date" value={node.time} onChange={(e) => updateNode(node.id, { time: e.target.value })} />
          </label>
        </div>

        <div className="insp-section-head">
          <span>Notes</span>
          <button className="link tiny" onClick={() => setPreview((p) => !p)}>
            {preview ? 'edit' : 'preview'}
          </button>
        </div>
        {preview ? (
          <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.body || '_No notes yet._') }} />
        ) : (
          <textarea
            className="insp-body-text"
            value={node.body}
            placeholder="Markdown notes… a node can hold a whole folder of thinking."
            onChange={(e) => updateNode(node.id, { body: e.target.value })}
          />
        )}

        <div className="insp-section-head">
          <span>Connections</span>
        </div>
        <div className="link-buttons">
          {LINK_KINDS.map((k) => (
            <button key={k} className="btn small" onClick={() => startLinking(node.id, k)}>
              {EDGE_LABEL[k]} →
            </button>
          ))}
        </div>
        <div className="conn-list">
          {connections.length === 0 && <div className="muted-text">No connections yet.</div>}
          {connections.map((e) => {
            const otherId = e.from === selectedId ? e.to : e.from
            const other = nodes[otherId]
            const dir = e.from === selectedId ? '→' : '←'
            return (
              <div key={e.id} className="conn-row">
                <span className="conn-kind">{EDGE_LABEL[e.kind]}</span>
                <span className="conn-dir">{dir}</span>
                <span className="conn-title" onClick={() => other && select(other.id)}>
                  {other?.title ?? '(missing)'}
                </span>
                <button className="link tiny danger" onClick={() => deleteEdge(e.id)}>
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <div className="insp-footer">
          <button className="btn danger" onClick={() => deleteNode(node.id)}>
            Delete node
          </button>
        </div>
      </div>
    </div>
  )
}
