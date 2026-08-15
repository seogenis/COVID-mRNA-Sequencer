import { useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  localSuggest,
  aiOrganize,
  composeFromBrainDump,
  suggestConnections,
  type OrganizeResult,
  type OrganizeMove,
  type GraphProposal,
  type ProposedEdge,
  type AiConfig,
} from '../lib/ai'
import { LEVEL_LABEL, EDGE_LABEL } from '../config'
import { HOSTED } from '../lib/env'
import { ProposalPreview } from './ProposalPreview'

type Tab = 'compose' | 'connect' | 'organize'

const EXAMPLE =
  'e.g. We should win information asymmetry in China. That means cheap hardware — I need to qualify a few actuator suppliers in Shenzhen and plan a sourcing trip. Also email Jeff Monday about the customs broker. Separately, big open question: UMI-style handheld data vs VLA teleoperation? Build a UMI prototype to judge data quality, and follow up with Jared on the eval harness…'

export function AiModal({ onClose }: { onClose: () => void }) {
  const nodes = useStore((s) => s.nodes)
  const branches = useStore((s) => s.branches)
  const edges = useStore((s) => s.edges)
  const apiKey = useStore((s) => s.settings.anthropicApiKey)
  const model = useStore((s) => s.settings.aiModel)
  const updateNode = useStore((s) => s.updateNode)
  const autoLayout = useStore((s) => s.autoLayout)
  const applyProposal = useStore((s) => s.applyProposal)
  const addEdge = useStore((s) => s.addEdge)

  const cfg: AiConfig = { apiKey, model }
  const nodeList = useMemo(() => Object.values(nodes), [nodes])
  const branchList = useMemo(() => Object.values(branches), [branches])

  const [tab, setTab] = useState<Tab>('compose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // compose
  const [dump, setDump] = useState('')
  const [proposal, setProposal] = useState<GraphProposal | null>(null)

  // connect
  const [links, setLinks] = useState<ProposedEdge[] | null>(null)

  // organize
  const [org, setOrg] = useState<OrganizeResult>(() => localSuggest(nodeList))

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const doCompose = () =>
    run(async () => {
      if (!dump.trim()) throw new Error('Paste a brain-dump first.')
      const p = await composeFromBrainDump(cfg, dump, branchList, nodeList)
      if (p.nodes.length === 0) throw new Error('The model returned no nodes. Try adding more detail.')
      setProposal(p)
    })

  const applyCompose = () => {
    if (!proposal) return
    const c = applyProposal(proposal)
    setProposal(null)
    setDump('')
    setNotice(`Added ${c.nodes} node(s), ${c.edges} link(s)${c.branches ? `, ${c.branches} branch(es)` : ''}.`)
  }

  const doConnect = () =>
    run(async () => {
      const found = await suggestConnections(
        cfg,
        nodeList,
        Object.values(edges).map((e) => ({ from: e.from, to: e.to })),
      )
      setLinks(found)
      if (found.length === 0) setNotice('No strong new connections found.')
    })

  const applyLink = (l: ProposedEdge) => {
    addEdge(l.from, l.to, l.kind)
    setLinks((prev) => (prev ? prev.filter((x) => x !== l) : prev))
  }
  const applyAllLinks = () => {
    links?.forEach((l) => addEdge(l.from, l.to, l.kind))
    setLinks([])
    setNotice('Connections added.')
  }

  const runOrganize = () =>
    run(async () => {
      const r = await aiOrganize(cfg, nodeList, branchList)
      setOrg(r)
    })
  const applyMove = (m: OrganizeMove) => {
    const patch: Record<string, unknown> = {}
    if (m.level) patch.level = m.level
    if (m.branchId) patch.branchId = m.branchId
    updateNode(m.id, patch, `AI move: ${nodes[m.id]?.title ?? m.id}`)
    setOrg((r) => ({ ...r, moves: r.moves.filter((x) => x !== m) }))
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>✦ AI</span>
          <button className="link" onClick={onClose}>
            close ✕
          </button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === 'compose' ? 'active' : ''}`} onClick={() => setTab('compose')}>
            Compose
          </button>
          <button className={`tab ${tab === 'connect' ? 'active' : ''}`} onClick={() => setTab('connect')}>
            Connect
          </button>
          <button className={`tab ${tab === 'organize' ? 'active' : ''}`} onClick={() => setTab('organize')}>
            Organize
          </button>
        </div>

        {HOSTED ? (
          <p className="field-hint keyless">
            You're in the hosted preview. Compose &amp; Connect call Anthropic directly and are blocked by the sandbox
            here — run the dev build (README) with your API key. The offline Organize heuristic still works.
          </p>
        ) : (
          !apiKey && (
            <p className="field-hint keyless">
              Add an Anthropic API key in Settings to use Compose &amp; Connect. Organize still runs an offline
              heuristic.
            </p>
          )
        )}
        {error && <p className="error-text">{error}</p>}
        {notice && <p className="notice-text">{notice}</p>}

        <div className="modal-body">
          {tab === 'compose' && (
            <>
              <p className="drawer-hint">
                Dump raw thoughts — messy is fine. Claude lays them out across the three altitudes into nodes, branches,
                and links. Nothing changes until you hit <strong>Add to space</strong>.
              </p>
              {!proposal ? (
                <>
                  <textarea
                    className="dump-input"
                    value={dump}
                    placeholder={EXAMPLE}
                    onChange={(e) => setDump(e.target.value)}
                  />
                  <div className="settings-actions">
                    <button className="btn primary" disabled={!apiKey || loading} onClick={doCompose}>
                      {loading ? 'Structuring…' : '✦ Structure this'}
                    </button>
                  </div>
                </>
              ) : (
                <ProposalPreview proposal={proposal} onApply={applyCompose} onDiscard={() => setProposal(null)} />
              )}
            </>
          )}

          {tab === 'connect' && (
            <>
              <p className="drawer-hint">
                Claude scans the existing nodes and proposes relationships that aren't drawn yet — dependencies and
                links you may have missed.
              </p>
              <div className="settings-actions">
                <button className="btn primary" disabled={!apiKey || loading} onClick={doConnect}>
                  {loading ? 'Scanning…' : '✦ Find missing links'}
                </button>
                {links && links.length > 0 && (
                  <button className="btn" onClick={applyAllLinks}>
                    Add all ({links.length})
                  </button>
                )}
              </div>
              <div className="move-list">
                {links?.map((l, i) => (
                  <div key={i} className="move-row">
                    <div className="move-main">
                      <div className="move-title">
                        {nodes[l.from]?.title ?? l.from} <span className="conn-kind">{EDGE_LABEL[l.kind]}</span>{' '}
                        {nodes[l.to]?.title ?? l.to}
                      </div>
                      {l.reason && <div className="move-detail">{l.reason}</div>}
                    </div>
                    <button className="btn small" onClick={() => applyLink(l)}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'organize' && (
            <>
              <p className="drawer-hint">{org.summary}</p>
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
                <button className="btn primary" disabled={!apiKey || loading} onClick={runOrganize}>
                  {loading ? 'Thinking…' : '✦ Run AI organize'}
                </button>
                {org.moves.length > 0 && (
                  <button className="btn" onClick={() => org.moves.forEach(applyMove)}>
                    Apply all ({org.moves.length})
                  </button>
                )}
              </div>
              <div className="move-list">
                {org.moves.length === 0 && <div className="muted-text">No suggested moves.</div>}
                {org.moves.map((m, i) => (
                  <div key={i} className="move-row">
                    <div className="move-main">
                      <div className="move-title">{nodes[m.id]?.title ?? m.id}</div>
                      <div className="move-detail">
                        {m.level && <span>→ {LEVEL_LABEL[m.level]}</span>}
                        {m.reason && <span className="move-reason"> — {m.reason}</span>}
                      </div>
                    </div>
                    <button className="btn small" onClick={() => applyMove(m)}>
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
