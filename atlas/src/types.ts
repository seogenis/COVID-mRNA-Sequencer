// ---------------------------------------------------------------------------
// Core domain model for Atlas.
//
// The spatial idea in three sentences:
//   - LEVEL (vertical height) is altitude: how abstract a node is.
//   - TIME (left -> right) is when it happened / is planned.
//   - BRANCH (depth into the scene) is which strategic thread it belongs to.
// A node's 3D position is derived from (time, level, branch) unless the user
// has dragged it, in which case an explicit offset is stored.
// ---------------------------------------------------------------------------

/** The three altitudes. This is the backbone of the whole tool. */
export type Level = 'strategy' | 'project' | 'execution'

/** What kind of thing a node is. Drives colour + filtering. */
export type NodeType =
  | 'strategy'
  | 'task'
  | 'info'
  | 'question'
  | 'decision'

/** Where a task-like node is in its lifecycle. */
export type Status = 'idea' | 'todo' | 'doing' | 'blocked' | 'done'

/** How two nodes relate. */
export type EdgeKind = 'hierarchy' | 'depends' | 'relates'

export interface Branch {
  id: string
  name: string
  /** hex colour, e.g. "#7c9cff" */
  color: string
  /** lane index -> depth position. Assigned automatically, editable. */
  lane: number
}

export interface AtlasNode {
  id: string
  title: string
  /** markdown body — a node can be a whole folder of notes. */
  body: string
  type: NodeType
  level: Level
  status: Status
  branchId: string
  owner: string
  /** ISO date (YYYY-MM-DD). Drives the X (time) position. */
  time: string
  /** manual position offset from the derived layout position, in world units. */
  offset: { x: number; y: number; z: number }
  /** whether this node has been dragged (locks it from auto-layout). */
  pinned: boolean
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface AtlasEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  label?: string
}

/** A single entry in the GitHub-style change log. */
export interface Commit {
  id: string
  at: number
  author: string
  message: string
  /** true if this change touched a strategy-level node and needs sign-off. */
  needsApproval: boolean
  approved: boolean
}

export interface Filters {
  types: Record<NodeType, boolean>
  levels: Record<Level, boolean>
  statuses: Record<Status, boolean>
  branchIds: string[] | null // null = all branches
  search: string
  /** hide (true) vs dim (false) nodes that don't match. */
  hideNonMatching: boolean
}

export type FocusPreset = 'all' | 'executive' | 'builder'

export interface AtlasState {
  nodes: Record<string, AtlasNode>
  edges: Record<string, AtlasEdge>
  branches: Record<string, Branch>
  commits: Commit[]
  filters: Filters
  focus: FocusPreset
  selectedId: string | null
  linkingFrom: string | null // node id we're drawing an edge from, or null
  me: string // current author name (no auth — just a label)
  settings: {
    anthropicApiKey: string
    aiModel: string
    showLevelPlanes: boolean
    showTimeGrid: boolean
  }
}
