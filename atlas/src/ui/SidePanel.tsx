import { useState } from 'react'
import { useStore } from '../store'
import type { NodeType, Level, Status } from '../types'
import { matches } from '../lib/layout'
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

type Tab = 'filters' | 'outline'

export function SidePanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<Tab>('filters')

  if (collapsed) {
    return (
      <button className="panel-reopen left" onClick={() => setCollapsed(false)} title="Show panel">
        ▸
      </button>
    )
  }

  return (
    <div className="side-panel">
      <div className="panel-head">
        <div className="tabs mini">
          <button className={`tab ${tab === 'filters' ? 'active' : ''}`} onClick={() => setTab('filters')}>
            Filters
          </button>
          <button className={`tab ${tab === 'outline' ? 'active' : ''}`} onClick={() => setTab('outline')}>
            Outline
          </button>
        </div>
        <button className="link" onClick={() => setCollapsed(true)}>
          ◂
        </button>
      </div>
      {tab === 'filters' ? <FiltersTab /> : <OutlineTab />}
    </div>
  )
}

function FiltersTab() {
  const filters = useStore((s) => s.filters)
  const toggleType = useStore((s) => s.toggleType)
  const toggleLevel = useStore((s) => s.toggleLevel)
  const toggleStatus = useStore((s) => s.toggleStatus)
  const toggleBranch = useStore((s) => s.toggleBranch)
  const toggleOwner = useStore((s) => s.toggleOwner)
  const setFilters = useStore((s) => s.setFilters)
  const branches = useStore((s) => s.branches)
  const nodes = useStore((s) => s.nodes)
  const addBranch = useStore((s) => s.addBranch)

  const branchOn = (id: string) => filters.branchIds === null || filters.branchIds.includes(id)
  const owners = [...new Set(Object.values(nodes).map((n) => n.owner || 'Unassigned'))].sort()
  const ownerOn = (o: string) => filters.owners === null || filters.owners.includes(o)

  return (
    <>
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
        <div className="filter-title">People</div>
        {owners.map((o) => (
          <label key={o} className="check-row">
            <input type="checkbox" checked={ownerOn(o)} onChange={() => toggleOwner(o)} />
            <span className="owner-avatar">{o.slice(0, 1).toUpperCase()}</span>
            <span>{o}</span>
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
    </>
  )
}

function OutlineTab() {
  const nodes = useStore((s) => s.nodes)
  const branches = useStore((s) => s.branches)
  const filters = useStore((s) => s.filters)
  const selectedId = useStore((s) => s.selectedId)
  const focusNode = useStore((s) => s.focusNode)

  const branchList = Object.values(branches)
  const byBranch = (bid: string) => Object.values(nodes).filter((n) => n.branchId === bid)
  const orphans = Object.values(nodes).filter((n) => !branches[n.branchId])

  return (
    <div className="outline">
      <div className="filter-title outline-hint">Click to fly there. Double-click a node in 3D does the same.</div>
      {branchList.map((b) => {
        const bn = byBranch(b.id)
        if (bn.length === 0) return null
        return (
          <div key={b.id} className="outline-branch">
            <div className="outline-branch-head">
              <span className="swatch" style={{ background: b.color }} />
              {b.name}
              <span className="outline-count">{bn.length}</span>
            </div>
            {LEVEL_ORDER.map((level) => {
              const group = bn.filter((n) => n.level === level).sort((a, z) => a.time.localeCompare(z.time))
              if (group.length === 0) return null
              return (
                <div key={level} className="outline-level">
                  <div className="outline-level-head">{LEVEL_LABEL[level]}</div>
                  {group.map((n) => {
                    const on = matches(n, filters)
                    return (
                      <button
                        key={n.id}
                        className={`outline-node ${selectedId === n.id ? 'sel' : ''} ${on ? '' : 'dim'}`}
                        onClick={() => focusNode(n.id)}
                        title={n.title}
                      >
                        <span className="node-status-dot" style={{ background: STATUS_COLOR[n.status] }} />
                        <span className="swatch" style={{ background: TYPE_COLOR[n.type] }} />
                        <span className="outline-node-title">{n.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })}
      {orphans.length > 0 && (
        <div className="outline-branch">
          <div className="outline-branch-head">Unassigned</div>
          {orphans.map((n) => (
            <button key={n.id} className="outline-node" onClick={() => focusNode(n.id)}>
              <span className="swatch" style={{ background: TYPE_COLOR[n.type] }} />
              <span className="outline-node-title">{n.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function randomColor() {
  const palette = ['#f2789f', '#5aa9e6', '#4bd0a0', '#f2c14e', '#8b7cff', '#e6825a', '#4be6d0']
  return palette[Math.floor(Math.random() * palette.length)]
}
