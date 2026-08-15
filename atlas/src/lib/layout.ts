import type { AtlasNode, Filters } from '../types'

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
