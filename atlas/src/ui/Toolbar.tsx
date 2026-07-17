import { useStore } from '../store'
import type { FocusPreset } from '../types'

const FOCUS: { key: FocusPreset; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Every altitude' },
  { key: 'executive', label: 'Executive', hint: 'Strategy + Project' },
  { key: 'builder', label: 'Builder', hint: 'Project + Execution' },
]

interface Props {
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenAi: () => void
}

export function Toolbar({ onOpenHistory, onOpenSettings, onOpenAi }: Props) {
  const focus = useStore((s) => s.focus)
  const setFocus = useStore((s) => s.setFocus)
  const addNode = useStore((s) => s.addNode)
  const search = useStore((s) => s.filters.search)
  const setFilters = useStore((s) => s.setFilters)
  const pending = useStore((s) => s.commits.filter((c) => c.needsApproval && !c.approved).length)

  const handleAdd = () => {
    const level = focus === 'executive' ? 'strategy' : focus === 'builder' ? 'execution' : 'project'
    const type = level === 'strategy' ? 'strategy' : level === 'execution' ? 'task' : 'task'
    addNode({ level, type, title: 'New node' })
  }

  return (
    <div className="toolbar">
      <div className="brand">
        <div className="brand-mark">◈</div>
        <div>
          <div className="brand-name">Atlas</div>
          <div className="brand-sub">strategy space · Synphony</div>
        </div>
      </div>

      <div className="segmented" role="tablist" aria-label="Focus">
        {FOCUS.map((f) => (
          <button
            key={f.key}
            className={`seg ${focus === f.key ? 'active' : ''}`}
            onClick={() => setFocus(f.key)}
            title={f.hint}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="search">
        <input
          value={search}
          placeholder="Search nodes…"
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      <div className="toolbar-actions">
        <button className="btn primary" onClick={handleAdd}>
          + Node
        </button>
        <button className="btn" onClick={onOpenAi} title="Organize the space">
          ✦ Organize
        </button>
        <button className="btn" onClick={onOpenHistory} title="Change history">
          History
          {pending > 0 && <span className="badge">{pending}</span>}
        </button>
        <button className="btn icon" onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>
    </div>
  )
}
