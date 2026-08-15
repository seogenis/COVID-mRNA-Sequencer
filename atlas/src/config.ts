import type { Level, NodeType, Status, EdgeKind } from './types'

// World-space Y (height) for each altitude. Strategy sits on top.
export const LEVEL_Y: Record<Level, number> = {
  strategy: 6,
  project: 0,
  execution: -6,
}

export const LEVEL_ORDER: Level[] = ['strategy', 'project', 'execution']

export const LEVEL_LABEL: Record<Level, string> = {
  strategy: 'Strategy',
  project: 'Project',
  execution: 'Execution',
}

export const LEVEL_BLURB: Record<Level, string> = {
  strategy: 'High-level bets & concepts — where the company is trying to go.',
  project: 'Micro-projects with concrete deliverables.',
  execution: 'The specific next actions. Email Jeff. Follow up with Jared.',
}

// Colour per node type.
export const TYPE_COLOR: Record<NodeType, string> = {
  strategy: '#8b7cff', // violet
  task: '#4bd0a0', // green
  info: '#5aa9e6', // blue
  question: '#f2c14e', // amber
  decision: '#f2789f', // pink
}

export const TYPE_LABEL: Record<NodeType, string> = {
  strategy: 'Strategy',
  task: 'Task',
  info: 'Info',
  question: 'Question',
  decision: 'Decision',
}

export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea',
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

export const STATUS_COLOR: Record<Status, string> = {
  idea: '#8b93a7',
  todo: '#5aa9e6',
  doing: '#f2c14e',
  blocked: '#f2789f',
  done: '#4bd0a0',
}

export const EDGE_COLOR: Record<EdgeKind, string> = {
  hierarchy: '#5b6478',
  depends: '#f2789f',
  relates: '#4b8f7f',
}

export const EDGE_LABEL: Record<EdgeKind, string> = {
  hierarchy: 'contains',
  depends: 'depends on',
  relates: 'relates to',
}

// Time axis: how many world units per day, and the anchor date (world x = 0).
export const UNITS_PER_DAY = 0.13
export const TIME_ANCHOR = '2026-01-01'
export const LANE_DEPTH = 9 // world units between branch lanes

export function dateToX(iso: string): number {
  const d = Date.parse(iso + 'T00:00:00Z')
  const anchor = Date.parse(TIME_ANCHOR + 'T00:00:00Z')
  const days = (d - anchor) / 86_400_000
  return days * UNITS_PER_DAY
}

export function laneToZ(lane: number): number {
  return lane * LANE_DEPTH
}

/** Inverse of dateToX: world x -> ISO date (used by click-to-create). */
export function xToDate(x: number): string {
  const anchor = Date.parse(TIME_ANCHOR + 'T00:00:00Z')
  const ms = anchor + (x / UNITS_PER_DAY) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Inverse of laneToZ: world z -> nearest lane index. */
export function zToLane(z: number): number {
  return Math.round(z / LANE_DEPTH)
}
