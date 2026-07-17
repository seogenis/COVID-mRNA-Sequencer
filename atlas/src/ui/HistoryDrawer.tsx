import { useStore } from '../store'

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const commits = useStore((s) => s.commits)
  const approve = useStore((s) => s.approve)

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Change history</span>
          <button className="link" onClick={onClose}>
            close ✕
          </button>
        </div>
        <p className="drawer-hint">
          A lightweight commit log. Edits to <strong>strategy-level</strong> nodes made by someone other than their
          author are flagged for sign-off — the seed of a GitHub-style approval flow.
        </p>
        <div className="commit-list">
          {commits.length === 0 && <div className="muted-text">No changes yet.</div>}
          {commits.map((c) => (
            <div key={c.id} className={`commit-row ${c.needsApproval && !c.approved ? 'pending' : ''}`}>
              <div className="commit-main">
                <span className="commit-author">{c.author}</span>
                <span className="commit-msg">{c.message}</span>
              </div>
              <div className="commit-side">
                <span className="commit-time">{timeAgo(c.at)}</span>
                {c.needsApproval &&
                  (c.approved ? (
                    <span className="approved-chip">approved</span>
                  ) : (
                    <button className="btn small" onClick={() => approve(c.id)}>
                      Approve
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
