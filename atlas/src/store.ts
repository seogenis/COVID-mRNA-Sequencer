import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

const ALL_TYPES: NodeType[] = ['strategy', 'task', 'info', 'question', 'decision']
const ALL_STATUS: Status[] = ['idea', 'todo', 'doing', 'blocked', 'done']

function uid(prefix = 'n'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function defaultFilters(): Filters {
  return {
    types: Object.fromEntries(ALL_TYPES.map((t) => [t, true])) as Record<NodeType, boolean>,
    levels: Object.fromEntries(LEVEL_ORDER.map((l) => [l, true])) as Record<Level, boolean>,
    statuses: Object.fromEntries(ALL_STATUS.map((s) => [s, true])) as Record<Status, boolean>,
    branchIds: null,
    search: '',
    hideNonMatching: false,
  }
}

function keyed<T extends { id: string }>(arr: T[]): Record<string, T> {
  return Object.fromEntries(arr.map((x) => [x.id, x]))
}

interface Actions {
  addNode: (partial?: Partial<AtlasNode>) => string
  updateNode: (id: string, patch: Partial<AtlasNode>, message?: string) => void
  moveNode: (id: string, offset: { x: number; y: number; z: number }) => void
  deleteNode: (id: string) => void

  addEdge: (from: string, to: string, kind: EdgeKind) => void
  deleteEdge: (id: string) => void

  addBranch: (name: string, color: string) => string
  updateBranch: (id: string, patch: Partial<Branch>) => void

  setFilters: (patch: Partial<Filters>) => void
  toggleType: (t: NodeType) => void
  toggleLevel: (l: Level) => void
  toggleStatus: (s: Status) => void
  toggleBranch: (id: string) => void
  setFocus: (f: FocusPreset) => void

  select: (id: string | null) => void
  startLinking: (id: string, kind: EdgeKind) => void
  cancelLinking: () => void

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
  me: string
  settings: { anthropicApiKey: string; showLevelPlanes: boolean; showTimeGrid: boolean }
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
      me: 'You',
      settings: { anthropicApiKey: '', showLevelPlanes: true, showTimeGrid: true },

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
          return { edges: { ...s.edges, [e.id]: e }, linkingFrom: null }
        })
      },

      deleteEdge: (id) => {
        set((s) => {
          const edges = { ...s.edges }
          delete edges[id]
          return { edges }
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
          return { nodes, commits: logCommit(s.commits, s.me, 'auto-organized the space', false) }
        })
      },

      resetSeed: () =>
        set({
          nodes: keyed(seedNodes),
          edges: keyed(seedEdges),
          branches: keyed(seedBranches),
          commits: [],
          filters: defaultFilters(),
          focus: 'all',
          selectedId: null,
          linkingFrom: null,
        }),

      importState: (json) => {
        try {
          const data = JSON.parse(json)
          if (!data.nodes || !data.branches) return false
          set({
            nodes: Array.isArray(data.nodes) ? keyed(data.nodes) : data.nodes,
            edges: Array.isArray(data.edges) ? keyed(data.edges) : data.edges ?? {},
            branches: Array.isArray(data.branches) ? keyed(data.branches) : data.branches,
            commits: data.commits ?? [],
            selectedId: null,
            linkingFrom: null,
          })
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
    },
  ),
)
