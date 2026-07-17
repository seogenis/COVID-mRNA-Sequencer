import { useState } from 'react'
import { useStore } from '../store'
import type { NodeType, Level, Status } from '../types'
import {
  TYPE_COLOR,
  TYPE_LABEL,
  LEVEL_ORDER,
  LEVEL_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
  EDGE_COLOR,
  EDGE_LABEL,
} from '../config'

const TYPES: NodeType[] = ['strategy', 'task', 'info', 'question', 'decision']
const STATUSES: Status[] = ['idea', 'todo', 'doing', 'blocked', 'done']

export function SidePanel() {
  const filters = useStore((s) => s.filters)
  const toggleType = useStore((s) => s.toggleType)
  const toggleLevel = useStore((s) => s.toggleLevel)
  const toggleStatus = useStore((s) => s.toggleStatus)
  const toggleBranch = useStore((s) => s.toggleBranch)
  const setFilters = useStore((s) => s.setFilters)
  const branches = useStore((s) => s.branches)
  const addBranch = useStore((s) => s.addBranch)
  const [collapsed, setCollapsed] = useState(false)

  const branchOn = (id: string) => filters.branchIds === null || filters.branchIds.includes(id)

  if (collapsed) {
    return (
      <button className="panel-reopen left" onClick={() => setCollapsed(false)} title="Show filters">
        ▸
      </button>
    )
  }

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span>Filters</span>
        <button className="link" onClick={() => setCollapsed(true)}>
          ◂ hide
        </button>
      </div>

      <div className="filter-group">
        <div className="filter-title">Altitude</div>
        {LEVEL_ORDER.map((l: Level) => (
          <label key={l} className="check-row">
            <input type="checkbox" checked={filters.levels[l]} onChange={() => toggleLevel(l)} />
            <span>{LEVEL_LABEL[l]}</span>
          </label>
        ))}
      </div>

      <div className="filter-group">
        <div className="filter-title">Type</div>
        {TYPES.map((t) => (
          <label key={t} className="check-row">
            <input type="checkbox" checked={filters.types[t]} onChange={() => toggleType(t)} />
            <span className="swatch" style={{ background: TYPE_COLOR[t] }} />
            <span>{TYPE_LABEL[t]}</span>
          </label>
        ))}
      </div>

      <div className="filter-group">
        <div className="filter-title">Status</div>
        {STATUSES.map((st) => (
          <label key={st} className="check-row">
            <input type="checkbox" checked={filters.statuses[st]} onChange={() => toggleStatus(st)} />
            <span className="swatch round" style={{ background: STATUS_COLOR[st] }} />
            <span>{STATUS_LABEL[st]}</span>
          </label>
        ))}
      </div>

      <div className="filter-group">
        <div className="filter-title">
          Branches
          <button
            className="link tiny"
            onClick={() => {
              const name = prompt('New branch name?')
              if (name) addBranch(name, randomColor())
            }}
          >
            + add
          </button>
        </div>
        {Object.values(branches).map((b) => (
          <label key={b.id} className="check-row">
            <input type="checkbox" checked={branchOn(b.id)} onChange={() => toggleBranch(b.id)} />
            <span className="swatch" style={{ background: b.color }} />
            <span>{b.name}</span>
          </label>
        ))}
      </div>

      <div className="filter-group">
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.hideNonMatching}
            onChange={() => setFilters({ hideNonMatching: !filters.hideNonMatching })}
          />
          <span>Hide non-matching (vs dim)</span>
        </label>
      </div>

      <div className="filter-group legend">
        <div className="filter-title">Edges</div>
        {(['hierarchy', 'depends', 'relates'] as const).map((k) => (
          <div key={k} className="legend-row">
            <span className="legend-line" style={{ background: EDGE_COLOR[k] }} />
            <span>{EDGE_LABEL[k]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function randomColor() {
  const palette = ['#f2789f', '#5aa9e6', '#4bd0a0', '#f2c14e', '#8b7cff', '#e6825a', '#4be6d0']
  return palette[Math.floor(Math.random() * palette.length)]
}
