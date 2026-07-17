import type { AtlasNode, Branch, Level } from '../types'

// ---------------------------------------------------------------------------
// Optional AI organizer. Everything here degrades gracefully: with no API key
// the app is fully usable; the AI is a suggestion layer on top.
//
// Two entry points:
//   - localSuggest(): heuristic, no network. Groups + flags loose nodes.
//   - aiOrganize(): calls the Anthropic API directly from the browser to
//     propose level/branch reassignments and new relationships.
// ---------------------------------------------------------------------------

export interface OrganizeMove {
  id: string
  level?: Level
  branchId?: string
  reason?: string
}

export interface OrganizeResult {
  summary: string
  moves: OrganizeMove[]
}

/** Heuristic, offline. Flags nodes that look mis-levelled by their type. */
export function localSuggest(nodes: AtlasNode[]): OrganizeResult {
  const moves: OrganizeMove[] = []
  for (const n of nodes) {
    if (n.type === 'strategy' && n.level !== 'strategy') {
      moves.push({ id: n.id, level: 'strategy', reason: 'strategy-typed node above the strategy floor' })
    }
    if (n.type === 'task' && n.level === 'strategy') {
      moves.push({ id: n.id, level: 'project', reason: 'a task sitting on the strategy floor' })
    }
  }
  const summary = moves.length
    ? `${moves.length} node(s) look mis-filed by altitude. Review below.`
    : 'Nothing obviously mis-filed. The space looks tidy.'
  return { summary, moves }
}

const MODEL = 'claude-sonnet-5'

/** Calls Anthropic's Messages API directly from the browser. Needs a key. */
export async function aiOrganize(
  apiKey: string,
  nodes: AtlasNode[],
  branches: Branch[],
): Promise<OrganizeResult> {
  const compactNodes = nodes.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type,
    level: n.level,
    branchId: n.branchId,
  }))
  const branchList = branches.map((b) => ({ id: b.id, name: b.name }))

  const system =
    'You organize a startup strategy map. Nodes live on three altitudes: ' +
    '"strategy" (high-level bets), "project" (deliverables), "execution" (concrete next actions). ' +
    'Each node belongs to one branch (a strategic thread). ' +
    'Given the nodes and branches, propose the SMALLEST set of changes that make the map coherent: ' +
    'move a node to a better altitude or branch only when clearly warranted. ' +
    'Respond with ONLY a JSON object of shape ' +
    '{"summary": string, "moves": [{"id": string, "level"?: "strategy"|"project"|"execution", "branchId"?: string, "reason": string}]}. ' +
    'No prose outside the JSON.'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [
        {
          role: 'user',
          content: `Branches:\n${JSON.stringify(branchList)}\n\nNodes:\n${JSON.stringify(compactNodes)}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const text: string = data?.content?.[0]?.text ?? ''
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Model did not return JSON.')
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as OrganizeResult
  if (!Array.isArray(parsed.moves)) parsed.moves = []
  return parsed
}
