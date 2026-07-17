import type { GraphProposal } from '../lib/ai'
import { LEVEL_ORDER, LEVEL_LABEL, TYPE_COLOR, TYPE_LABEL } from '../config'
import type { Level } from '../types'

interface Props {
  proposal: GraphProposal
  onApply: () => void
  onDiscard: () => void
  applyLabel?: string
}

export function ProposalPreview({ proposal, onApply, onDiscard, applyLabel = 'Add to space' }: Props) {
  const branchName = (ref?: string): string | undefined => {
    if (!ref) return undefined
    const nb = proposal.branches.find((b) => b.tempId === ref)
    return nb?.name
  }

  return (
    <div className="proposal">
      {proposal.summary && <p className="drawer-hint">{proposal.summary}</p>}

      {proposal.branches.length > 0 && (
        <div className="proposal-branches">
          {proposal.branches.map((b) => (
            <span key={b.tempId} className="new-branch-chip" style={{ borderColor: b.color, color: b.color }}>
              + {b.name}
            </span>
          ))}
        </div>
      )}

      {LEVEL_ORDER.map((level: Level) => {
        const group = proposal.nodes.filter((n) => n.level === level)
        if (group.length === 0) return null
        return (
          <div key={level} className="proposal-group">
            <div className="proposal-group-head">{LEVEL_LABEL[level]}</div>
            {group.map((n) => (
              <div key={n.tempId} className="proposal-node">
                <span className="swatch" style={{ background: TYPE_COLOR[n.type] }} />
                <div className="proposal-node-main">
                  <div className="proposal-node-title">{n.title}</div>
                  {n.body && <div className="proposal-node-body">{n.body}</div>}
                </div>
                <span className="proposal-node-tags">
                  <span className="node-type-chip">{TYPE_LABEL[n.type]}</span>
                  {branchName(n.branch) && <span className="new-branch-mini">{branchName(n.branch)}</span>}
                </span>
              </div>
            ))}
          </div>
        )
      })}

      <div className="proposal-foot">
        <span className="muted-text">
          {proposal.nodes.length} node(s) · {proposal.edges.length} link(s)
          {proposal.branches.length ? ` · ${proposal.branches.length} branch(es)` : ''}
        </span>
        <div className="proposal-actions">
          <button className="btn" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn primary" onClick={onApply}>
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
