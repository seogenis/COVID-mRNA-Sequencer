import type { AtlasNode, Level } from '../types'

// ---------------------------------------------------------------------------
// 2D layout. The three altitudes are horizontal bands stacked top-to-bottom;
// time runs left → right. A node's (x, y) is derived from (time, level) plus a
// small within-band offset, and dragging inverts that: drop position → time +
// altitude. This is what makes "drag a task up into Strategy and it becomes
// strategy-level" work.
// ---------------------------------------------------------------------------

export const LEVELS: Level[] = ['strategy', 'project', 'execution']

export const BAND_H = 300 // visual height of one altitude band
export const BAND_GAP = 36 // gap between bands
export const CARD_W = 216 // node card width (for centring + fit math)
export const CARD_H = 96 // approx card height

const BAND_STRIDE = BAND_H + BAND_GAP

export function bandTop(level: Level): number {
  return LEVELS.indexOf(level) * BAND_STRIDE
}
export function bandCenterY(level: Level): number {
  return bandTop(level) + BAND_H / 2
}
export const CANVAS_TOP = 0
export const CANVAS_BOTTOM = bandTop('execution') + BAND_H

/** Nearest band for a world-y (used when a drag crosses a boundary). */
export function yToLevel(y: number): Level {
  let best: Level = 'project'
  let bestD = Infinity
  for (const l of LEVELS) {
    const d = Math.abs(y - bandCenterY(l))
    if (d < bestD) {
      bestD = d
      best = l
    }
  }
  return best
}

// Time axis.
export const PX_PER_DAY = 10
export const TIME_ANCHOR = '2026-01-01'

export function timeToX(iso: string): number {
  const d = Date.parse(iso + 'T00:00:00Z')
  const anchor = Date.parse(TIME_ANCHOR + 'T00:00:00Z')
  return ((d - anchor) / 86_400_000) * PX_PER_DAY
}
export function xToTime(x: number): string {
  const anchor = Date.parse(TIME_ANCHOR + 'T00:00:00Z')
  return new Date(anchor + (x / PX_PER_DAY) * 86_400_000).toISOString().slice(0, 10)
}

/** Centre point of a node's card in world coordinates. */
export function nodeXY(n: AtlasNode): { x: number; y: number } {
  return { x: timeToX(n.time) + n.offset.x, y: bandCenterY(n.level) + n.offset.y }
}

/** Clamp a within-band vertical offset so cards stay inside their band. */
export function clampBandOffset(offsetY: number): number {
  const limit = BAND_H / 2 - CARD_H / 2 - 6
  return Math.max(-limit, Math.min(limit, offsetY))
}
