import type { AtlasNode, Branch, Filters } from '../types'
import { LEVEL_Y, dateToX, laneToZ } from '../config'

/** World position of a node, combining derived layout + manual offset. */
export function nodePosition(n: AtlasNode, branch: Branch | undefined): [number, number, number] {
  const lane = branch?.lane ?? 0
  const x = dateToX(n.time) + n.offset.x
  const y = LEVEL_Y[n.level] + n.offset.y
  const z = laneToZ(lane) + n.offset.z
  return [x, y, z]
}

/** Does a node pass the active filters? */
export function matches(n: AtlasNode, f: Filters): boolean {
  if (!f.types[n.type]) return false
  if (!f.levels[n.level]) return false
  if (!f.statuses[n.status]) return false
  if (f.branchIds && !f.branchIds.includes(n.branchId)) return false
  if (f.owners && !f.owners.includes(n.owner || 'Unassigned')) return false
  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    const hay = (n.title + ' ' + n.body + ' ' + n.owner).toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}
