import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AtlasNode,
  AtlasEdge,
  Branch,
  Commit,
  Filters,
  FocusPreset,
  Level,
  NodeType,
  Status,
  EdgeKind,
} from './types'
import { seedBranches, seedNodes, seedEdges } from './seed'
import { LEVEL_ORDER } from './config'
import type { GraphProposal } from './lib/ai'

const ALL_TYPES: NodeType[] = ['strategy', 'task', 'info', 'question', 'decision']
const ALL_STATUS: Status[] = ['idea', 'todo', 'doing', 'blocked', 'done']

// Some sandboxed contexts (e.g. a published artifact iframe) can throw when
// touching localStorage. Fall back to an in-memory map so the app still runs.
const memoryStore: Record<string, string> = {}
const safeStorage = {
  getItem: (k: string): string | null => {
    try {
      return globalThis.localStorage?.getItem(k) ?? memoryStore[k] ?? null
    } catch {
      return memoryStore[k] ?? null
    }
  },
  setItem: (k: string, v: string): void => {
    try {
      globalThis.localStorage?.setItem(k, v)
    } catch {
      memoryStore[k] = v
    }
  },
  removeItem: (k: string): void => {
    try {
      globalThis.localStorage?.removeItem(k)
    } catch {
      delete memoryStore[k]
    }
  },
}

/** Transient request to fly the camera somewhere (never persisted). */
export type FrameRequest = { kind: 'all' } | { kind: 'node'; id: string }

function uid(prefix = 'n'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function defaultFilters(): Filters {
  return {
    types: Object.fromEntries(ALL_TYPES.map((t) => [t, true])) as Record<NodeType, boolean>,
    levels: Object.fromEntries(LEVEL_ORDER.map((l) => [l, true])) as Record<Level, boolean>,
    statuses: Object.fromEntries(ALL_STATUS.map((s) => [s, true])) as Record<Status, boolean>,
    branchIds: null,
    owners: null,
    search: '',
    hideNonMatching: false,
  }
}

function keyed<T extends { id: string }>(arr: T[]): Record<string, T> {
  return Object.fromEntries(arr.map((x) => [x.id, x]))
}

/** What Ctrl+Z restores. Structural ops push one of these before mutating. */
interface UndoSnapshot {
  nodes: Record<string, AtlasNode>
  edges: Record<string, AtlasEdge>
  branches: Record<string, Branch>
  commits: Commit[]
  label: string
}

const UNDO_CAP = 40

interface Actions {
  addNode: (partial?: Partial<AtlasNode>) => string
  updateNode: (id: string, patch: Partial<AtlasNode>, message?: string) => void
  moveNode: (id: string, offset: { x: number; y: number; z: number }) => void
  deleteNode: (id: string) => void

  addEdge: (from: string, to: string, kind: EdgeKind) => void
  deleteEdge: (id: string) => void

  addBranch: (name: string, color: string) => string
  updateBranch: (id: string, patch: Partial<Branch>) => void

  /** Apply an AI-proposed subgraph (branches + nodes + edges) in one commit. */
  applyProposal: (proposal: GraphProposal) => { nodes: number; edges: number; branches: number }

  setFilters: (patch: Partial<Filters>) => void
  toggleType: (t: NodeType) => void
  toggleLevel: (l: Level) => void
  toggleStatus: (s: Status) => void
  toggleBranch: (id: string) => void
  toggleOwner: (owner: string) => void
  setFocus: (f: FocusPreset) => void

  undo: () => void

  select: (id: string | null) => void
  startLinking: (id: string, kind: EdgeKind) => void
  cancelLinking: () => void

  frameAll: () => void
  frameNode: (id: string) => void
  clearFrame: () => void
  focusNode: (id: string) => void

  approve: (commitId: string) => void
  setMe: (name: string) => void
  setSetting: <K extends keyof State['settings']>(key: K, value: State['settings'][K]) => void

  autoLayout: () => void
  resetSeed: () => void
  importState: (json: string) => boolean
  exportState: () => string
}

interface State {
  nodes: Record<string, AtlasNode>
  edges: Record<string, AtlasEdge>
  branches: Record<string, Branch>
  commits: Commit[]
  filters: Filters
  focus: FocusPreset
  selectedId: string | null
  linkingFrom: string | null
  linkKind: EdgeKind
  frameRequest: FrameRequest | null
  /** Undo stack for structural changes (add/delete/AI/layout). Not persisted. */
  past: UndoSnapshot[]
  me: string
  settings: { anthropicApiKey: string; aiModel: string; showLevelPlanes: boolean; showTimeGrid: boolean }
}

/** Immutable-friendly: state records are replaced, never mutated, so sharing refs is safe. */
function pushUndo(s: State, label: string): UndoSnapshot[] {
  return [
    ...s.past.slice(-(UNDO_CAP - 1)),
    { nodes: s.nodes, edges: s.edges, branches: s.branches, commits: s.commits, label },
  ]
}

function logCommit(commits: Commit[], author: string, message: string, needsApproval: boolean): Commit[] {
  const c: Commit = {
    id: uid('c'),
    at: Date.now(),
    author,
    message,
    needsApproval,
    approved: !needsApproval,
  }
  return [c, ...commits].slice(0, 200)
}

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      nodes: keyed(seedNodes),
      edges: keyed(seedEdges),
      branches: keyed(seedBranches),
      commits: [],
      filters: defaultFilters(),
      focus: 'all',
      selectedId: null,
      linkingFrom: null,
      linkKind: 'hierarchy',
      frameRequest: null,
      past: [],
      me: 'You',
      settings: { anthropicApiKey: '', aiModel: 'claude-sonnet-5', showLevelPlanes: true, showTimeGrid: true },

      addNode: (partial) => {
        const id = partial?.id ?? uid()
        const branchId =
          partial?.branchId ?? Object.keys(get().branches)[0] ?? 'b-default'
        const today = new Date().toISOString().slice(0, 10)
        const n: AtlasNode = {
          id,
          title: partial?.title ?? 'New node',
          body: partial?.body ?? '',
          type: partial?.type ?? 'task',
          level: partial?.level ?? 'execution',
          status: partial?.status ?? 'idea',
          branchId,
          owner: partial?.owner ?? get().me,
          time: partial?.time ?? today,
          offset: partial?.offset ?? { x: 0, y: 0, z: 0 },
          pinned: partial?.pinned ?? false,
          createdBy: get().me,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({
          past: pushUndo(s, 'add node'),
          nodes: { ...s.nodes, [id]: n },
          selectedId: id,
          commits: logCommit(s.commits, s.me, `created "${n.title}"`, n.level === 'strategy'),
        }))
        return id
      },

      updateNode: (id, patch, message) => {
        set((s) => {
          const prev = s.nodes[id]
          if (!prev) return s
          const next = { ...prev, ...patch, updatedAt: Date.now() }
          const touchesStrategy = prev.level === 'strategy' || next.level === 'strategy'
          const byNonAuthor = s.me !== prev.createdBy
          return {
            nodes: { ...s.nodes, [id]: next },
            commits: logCommit(
              s.commits,
              s.me,
              message ?? `edited "${next.title}"`,
              touchesStrategy && byNonAuthor,
            ),
          }
        })
      },

      moveNode: (id, offset) => {
        set((s) => {
          const prev = s.nodes[id]
          if (!prev) return s
          return { nodes: { ...s.nodes, [id]: { ...prev, offset, pinned: true, updatedAt: Date.now() } } }
        })
      },

      deleteNode: (id) => {
        set((s) => {
          const nodes = { ...s.nodes }
          const title = nodes[id]?.title ?? id
          delete nodes[id]
          const edges = Object.fromEntries(
            Object.entries(s.edges).filter(([, e]) => e.from !== id && e.to !== id),
          )
          return {
            past: pushUndo(s, `delete "${title}"`),
            nodes,
            edges,
            selectedId: s.selectedId === id ? null : s.selectedId,
            commits: logCommit(s.commits, s.me, `deleted "${title}"`, false),
          }
        })
      },

      addEdge: (from, to, kind) => {
        if (from === to) return
        set((s) => {
          const exists = Object.values(s.edges).some(
            (e) => e.from === from && e.to === to && e.kind === kind,
          )
          if (exists) return { linkingFrom: null }
          const e: AtlasEdge = { id: uid('e'), from, to, kind }
          return { past: pushUndo(s, 'add link'), edges: { ...s.edges, [e.id]: e }, linkingFrom: null }
        })
      },

      deleteEdge: (id) => {
        set((s) => {
          const edges = { ...s.edges }
          delete edges[id]
          return { past: pushUndo(s, 'remove link'), edges }
        })
      },

      addBranch: (name, color) => {
        const id = uid('b')
        const lanes = Object.values(get().branches).map((b) => b.lane)
        const lane = lanes.length ? Math.max(...lanes) + 1 : 0
        set((s) => ({ branches: { ...s.branches, [id]: { id, name, color, lane } } }))
        return id
      },

      updateBranch: (id, patch) => {
        set((s) => {
          const prev = s.branches[id]
          if (!prev) return s
          return { branches: { ...s.branches, [id]: { ...prev, ...patch } } }
        })
      },

      applyProposal: (proposal) => {
        const palette = ['#f2789f', '#5aa9e6', '#4bd0a0', '#f2c14e', '#8b7cff', '#e6825a', '#4be6d0']
        const state = get()
        const branches = { ...state.branches }
        const nodes = { ...state.nodes }
        const edges = { ...state.edges }
        const today = new Date().toISOString().slice(0, 10)

        // 1) branches
        const branchMap: Record<string, string> = {}
        let lane = Math.max(0, ...Object.values(branches).map((b) => b.lane))
        proposal.branches.forEach((b, i) => {
          const id = uid('b')
          lane += 1
          branches[id] = { id, name: b.name, color: b.color || palette[i % palette.length], lane }
          branchMap[b.tempId] = id
        })
        const fallbackBranch = Object.keys(branches)[0]

        // 2) nodes (with anti-overlap fan-out per time/level/branch cell)
        const nodeMap: Record<string, string> = {}
        const cell: Record<string, number> = {}
        for (const pn of proposal.nodes) {
          const id = uid('n')
          const branchId = pn.branch ? branchMap[pn.branch] ?? (branches[pn.branch] ? pn.branch : fallbackBranch) : fallbackBranch
          const time = pn.time ?? today
          const key = `${pn.level}|${branchId}|${time}`
          const n = (cell[key] = (cell[key] ?? 0) + 1) - 1
          nodes[id] = {
            id,
            title: pn.title,
            body: pn.body ?? '',
            type: pn.type,
            level: pn.level,
            status: pn.status ?? 'idea',
            branchId,
            owner: state.me,
            time,
            offset: { x: n * 4.2, y: 0, z: n % 2 === 0 ? 0 : 2.2 },
            pinned: false,
            createdBy: state.me,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          nodeMap[pn.tempId] = id
        }

        // 3) edges (resolve temp ids or pass through existing ids)
        let edgeCount = 0
        const resolve = (ref: string) => nodeMap[ref] ?? (nodes[ref] ? ref : null)
        for (const pe of proposal.edges) {
          const from = resolve(pe.from)
          const to = resolve(pe.to)
          if (!from || !to || from === to) continue
          const dup = Object.values(edges).some((e) => e.from === from && e.to === to && e.kind === pe.kind)
          if (dup) continue
          const id = uid('e')
          edges[id] = { id, from, to, kind: pe.kind }
          edgeCount += 1
        }

        const counts = { nodes: proposal.nodes.length, edges: edgeCount, branches: proposal.branches.length }
        set((s) => ({
          past: pushUndo(s, 'AI changes'),
          branches,
          nodes,
          edges,
          commits: logCommit(
            s.commits,
            s.me,
            `AI added ${counts.nodes} node(s), ${counts.edges} link(s)${counts.branches ? `, ${counts.branches} branch(es)` : ''}`,
            false,
          ),
        }))
        return counts
      },

      setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      toggleType: (t) =>
        set((s) => ({ filters: { ...s.filters, types: { ...s.filters.types, [t]: !s.filters.types[t] } } })),
      toggleLevel: (l) =>
        set((s) => ({ filters: { ...s.filters, levels: { ...s.filters.levels, [l]: !s.filters.levels[l] } } })),
      toggleStatus: (st) =>
        set((s) => ({
          filters: { ...s.filters, statuses: { ...s.filters.statuses, [st]: !s.filters.statuses[st] } },
        })),
      toggleBranch: (id) =>
        set((s) => {
          const cur = s.filters.branchIds
          if (cur === null) {
            // start from all-selected, then remove this one
            const all = Object.keys(s.branches).filter((b) => b !== id)
            return { filters: { ...s.filters, branchIds: all } }
          }
          const has = cur.includes(id)
          const next = has ? cur.filter((b) => b !== id) : [...cur, id]
          return { filters: { ...s.filters, branchIds: next.length === Object.keys(s.branches).length ? null : next } }
        }),
      toggleOwner: (owner) =>
        set((s) => {
          const all = [...new Set(Object.values(s.nodes).map((n) => n.owner || 'Unassigned'))]
          const cur = s.filters.owners
          if (cur === null) {
            return { filters: { ...s.filters, owners: all.filter((o) => o !== owner) } }
          }
          const has = cur.includes(owner)
          const next = has ? cur.filter((o) => o !== owner) : [...cur, owner]
          return { filters: { ...s.filters, owners: next.length >= all.length ? null : next } }
        }),

      setFocus: (f) =>
        set((s) => {
          const levels = { ...s.filters.levels }
          if (f === 'executive') {
            levels.strategy = true
            levels.project = true
            levels.execution = false
          } else if (f === 'builder') {
            levels.strategy = false
            levels.project = true
            levels.execution = true
          } else {
            levels.strategy = true
            levels.project = true
            levels.execution = true
          }
          return { focus: f, filters: { ...s.filters, levels } }
        }),

      select: (id) => set({ selectedId: id, linkingFrom: null }),
      startLinking: (id, kind) => set({ linkingFrom: id, linkKind: kind }),
      cancelLinking: () => set({ linkingFrom: null }),

      frameAll: () => set({ frameRequest: { kind: 'all' } }),
      frameNode: (id) => set({ frameRequest: { kind: 'node', id } }),
      clearFrame: () => set({ frameRequest: null }),
      focusNode: (id) => set({ selectedId: id, linkingFrom: null, frameRequest: { kind: 'node', id } }),

      approve: (commitId) =>
        set((s) => ({
          commits: s.commits.map((c) => (c.id === commitId ? { ...c, approved: true } : c)),
        })),

      setMe: (name) => set({ me: name || 'You' }),
      setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),

      autoLayout: () => {
        // Clear manual offsets so nodes snap back to (time, level, branch).
        set((s) => {
          const nodes = Object.fromEntries(
            Object.entries(s.nodes).map(([id, n]) => [id, { ...n, offset: { x: 0, y: 0, z: 0 }, pinned: false }]),
          )
          return {
            past: pushUndo(s, 're-snap layout'),
            nodes,
            commits: logCommit(s.commits, s.me, 'auto-organized the space', false),
          }
        })
      },

      undo: () => {
        set((s) => {
          const last = s.past[s.past.length - 1]
          if (!last) return s
          return {
            past: s.past.slice(0, -1),
            nodes: last.nodes,
            edges: last.edges,
            branches: last.branches,
            commits: last.commits,
            selectedId: s.selectedId && last.nodes[s.selectedId] ? s.selectedId : null,
            linkingFrom: null,
          }
        })
      },

      resetSeed: () =>
        set((s) => ({
          past: pushUndo(s, 'reset to seed'),
          nodes: keyed(seedNodes),
          edges: keyed(seedEdges),
          branches: keyed(seedBranches),
          commits: [],
          filters: defaultFilters(),
          focus: 'all',
          selectedId: null,
          linkingFrom: null,
        })),

      importState: (json) => {
        try {
          const data = JSON.parse(json)
          if (!data.nodes || !data.branches) return false
          set((s) => ({
            past: pushUndo(s, 'import'),
            nodes: Array.isArray(data.nodes) ? keyed(data.nodes) : data.nodes,
            edges: Array.isArray(data.edges) ? keyed(data.edges) : data.edges ?? {},
            branches: Array.isArray(data.branches) ? keyed(data.branches) : data.branches,
            commits: data.commits ?? [],
            selectedId: null,
            linkingFrom: null,
          }))
          return true
        } catch {
          return false
        }
      },

      exportState: () => {
        const s = get()
        return JSON.stringify(
          {
            nodes: Object.values(s.nodes),
            edges: Object.values(s.edges),
            branches: Object.values(s.branches),
            commits: s.commits,
          },
          null,
          2,
        )
      },
    }),
    {
      name: 'atlas-store-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        branches: s.branches,
        commits: s.commits,
        filters: s.filters,
        focus: s.focus,
        me: s.me,
        settings: s.settings,
      }),
      // Deep-merge persisted state so newly added setting defaults (e.g. aiModel)
      // fill in for people who saved state before those fields existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          filters: { ...current.filters, ...(p.filters ?? {}) },
        }
      },
    },
  ),
)
