import { useRef } from 'react'
import { useStore } from '../store'
import { matches } from '../lib/layout'
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
  const undo = useStore((s) => s.undo)
  const undoLabel = useStore((s) => s.past[s.past.length - 1]?.label)
  const nodes = useStore((s) => s.nodes)
  const filters = useStore((s) => s.filters)
  const focusNode = useStore((s) => s.focusNode)
  const cycleRef = useRef(0)

  const matchCount = search.trim()
    ? Object.values(nodes).filter((n) => matches(n, filters)).length
    : null

  // Enter flies to the next matching node, cycling through all matches.
  const flyToMatch = () => {
    const hits = Object.values(nodes)
      .filter((n) => matches(n, filters))
      .sort((a, z) => a.title.localeCompare(z.title))
    if (hits.length === 0) return
    focusNode(hits[cycleRef.current % hits.length].id)
    cycleRef.current += 1
  }

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
          placeholder="Search nodes…  (Enter flies to matches)"
          onChange={(e) => {
            cycleRef.current = 0
            setFilters({ search: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') flyToMatch()
          }}
        />
        {matchCount !== null && <span className="search-count">{matchCount}</span>}
      </div>

      <div className="toolbar-actions">
        <button
          className="btn icon"
          onClick={undo}
          disabled={!undoLabel}
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
        >
          ↩
        </button>
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
