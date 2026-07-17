import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { localSuggest, aiOrganize, type OrganizeResult, type OrganizeMove } from '../lib/ai'
import { LEVEL_LABEL } from '../config'

export function AiModal({ onClose }: { onClose: () => void }) {
  const nodes = useStore((s) => s.nodes)
  const branches = useStore((s) => s.branches)
  const apiKey = useStore((s) => s.settings.anthropicApiKey)
  const updateNode = useStore((s) => s.updateNode)
  const autoLayout = useStore((s) => s.autoLayout)

  const nodeList = useMemo(() => Object.values(nodes), [nodes])
  const branchList = useMemo(() => Object.values(branches), [branches])
  const [result, setResult] = useState<OrganizeResult>(() => localSuggest(nodeList))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyMove = (m: OrganizeMove) => {
    const patch: Record<string, unknown> = {}
    if (m.level) patch.level = m.level
    if (m.branchId) patch.branchId = m.branchId
    updateNode(m.id, patch, `AI move: ${nodes[m.id]?.title ?? m.id}`)
    setResult((r) => ({ ...r, moves: r.moves.filter((x) => x !== m) }))
  }

  const applyAll = () => {
    result.moves.forEach(applyMove)
  }

  const runAi = async () => {
    setError(null)
    setLoading(true)
    try {
      const r = await aiOrganize(apiKey, nodeList, branchList)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const branchName = (id?: string) => (id ? branches[id]?.name ?? id : undefined)

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>✦ Organize</span>
          <button className="link" onClick={onClose}>
            close ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="drawer-hint">{result.summary}</p>

          <div className="settings-actions">
            <button
              className="btn"
              onClick={() => {
                autoLayout()
                onClose()
              }}
            >
              Re-snap layout
            </button>
            <button className="btn primary" disabled={!apiKey || loading} onClick={runAi} title={apiKey ? '' : 'Add an API key in Settings'}>
              {loading ? 'Thinking…' : 'Run AI organize'}
            </button>
            {result.moves.length > 0 && (
              <button className="btn" onClick={applyAll}>
                Apply all ({result.moves.length})
              </button>
            )}
          </div>

          {!apiKey && (
            <p className="field-hint">
              Tip: the offline heuristic runs automatically. Add an Anthropic API key in Settings to let Claude propose
              deeper reorganizations.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}

          <div className="move-list">
            {result.moves.length === 0 && <div className="muted-text">No suggested moves.</div>}
            {result.moves.map((m, i) => (
              <div key={i} className="move-row">
                <div className="move-main">
                  <div className="move-title">{nodes[m.id]?.title ?? m.id}</div>
                  <div className="move-detail">
                    {m.level && <span>→ {LEVEL_LABEL[m.level]}</span>}
                    {m.branchId && <span> · {branchName(m.branchId)}</span>}
                    {m.reason && <span className="move-reason"> — {m.reason}</span>}
                  </div>
                </div>
                <button className="btn small" onClick={() => applyMove(m)}>
                  Apply
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
