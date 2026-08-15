import type { AtlasNode, Level } from '../types'

// ---------------------------------------------------------------------------
// 2D swimlane layout.
//
//   - Three altitude bands stacked top → bottom (Strategy / Project / Execution).
//   - Time runs left → right (x = date).
//   - Within a band, cards are packed into ROWS so they never overlap: each new
//     card (in time order) drops into the first row whose last card has ended.
//   - Bands grow as tall as they need to hold their rows.
//
// Vertical position inside a band is NOT meaningful (only the band is), so we
// pack automatically and keep the picture clean. Dragging a card changes its
// band (altitude) and its x (date); the row is then recomputed.
// ---------------------------------------------------------------------------

export const LEVELS: Level[] = ['strategy', 'project', 'execution']

export const CARD_W = 232
export const CARD_H = 104
export const ROW_H = CARD_H + 26 // vertical stride between rows in a band
export const GAP_X = 26 // min horizontal gap between cards in the same row
export const BAND_PAD = 34 // top/bottom breathing room inside a band
export const MIN_ROWS = 1

export const PX_PER_DAY = 11
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

export interface BandInfo {
  level: Level
  top: number
  height: number
  rows: number
}

export interface Layout {
  pos: Record<string, { x: number; y: number }>
  bands: BandInfo[]
  totalHeight: number
  minX: number
  maxX: number
}

/** Pack every node into non-overlapping rows within its altitude band. */
export function computeLayout(nodes: AtlasNode[]): Layout {
  const pos: Record<string, { x: number; y: number }> = {}
  const bands: BandInfo[] = []
  let top = 0
  let minX = Infinity
  let maxX = -Infinity

  for (const level of LEVELS) {
    const inBand = nodes
      .filter((n) => n.level === level)
      .map((n) => ({ id: n.id, x: timeToX(n.time) }))
      .sort((a, b) => a.x - b.x)

    const rowRight: number[] = [] // right edge of the last card placed in each row
    const rowOf: Record<string, number> = {}
    for (const item of inBand) {
      const left = item.x - CARD_W / 2
      let row = rowRight.findIndex((r) => left >= r + GAP_X)
      if (row === -1) {
        row = rowRight.length
        rowRight.push(-Infinity)
      }
      rowRight[row] = item.x + CARD_W / 2
      rowOf[item.id] = row
      minX = Math.min(minX, left)
      maxX = Math.max(maxX, item.x + CARD_W / 2)
    }

    const rows = Math.max(MIN_ROWS, rowRight.length)
    const height = BAND_PAD * 2 + rows * ROW_H
    bands.push({ level, top, height, rows })
    for (const item of inBand) {
      pos[item.id] = { x: item.x, y: top + BAND_PAD + rowOf[item.id] * ROW_H + ROW_H / 2 }
    }
    top += height
  }

  if (minX === Infinity) {
    minX = 0
    maxX = 0
  }
  return { pos, bands, totalHeight: top, minX, maxX }
}

/** Which band contains a world-y (for a drop). */
export function levelAtY(y: number, bands: BandInfo[]): Level {
  for (const b of bands) if (y >= b.top && y < b.top + b.height) return b.level
  if (bands.length && y < bands[0].top) return bands[0].level
  return bands.length ? bands[bands.length - 1].level : 'project'
}
