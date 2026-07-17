import type { AtlasNode, Branch, Level, NodeType, Status, EdgeKind } from '../types'

// ---------------------------------------------------------------------------
// AI layer. Everything degrades gracefully: with no API key the app is fully
// usable and the offline heuristic still runs. With a key, these functions call
// Anthropic's Messages API directly from the browser.
//
//   - localSuggest()        heuristic, no network — flags mis-filed nodes
//   - aiOrganize()          propose level/branch reassignments
//   - composeFromBrainDump() turn a raw brain-dump into a whole subgraph
//   - decomposeNode()       break one node into its children a level down
//   - suggestConnections()  propose missing edges between existing nodes
// ---------------------------------------------------------------------------

export interface AiConfig {
  apiKey: string
  model: string
}

// ---- shared proposal shapes ------------------------------------------------

export interface ProposedBranch {
  tempId: string
  name: string
  color?: string
}

export interface ProposedNode {
  tempId: string
  title: string
  body?: string
  type: NodeType
  level: Level
  status?: Status
  /** existing branch id OR a ProposedBranch.tempId */
  branch?: string
  /** ISO date, optional */
  time?: string
}

export interface ProposedEdge {
  from: string // node tempId or existing node id
  to: string
  kind: EdgeKind
  reason?: string
}

export interface GraphProposal {
  summary: string
  branches: ProposedBranch[]
  nodes: ProposedNode[]
  edges: ProposedEdge[]
}

// ---- offline heuristic -----------------------------------------------------

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

// ---- low-level API call ----------------------------------------------------

const VALID_TYPES: NodeType[] = ['strategy', 'task', 'info', 'question', 'decision']
const VALID_LEVELS: Level[] = ['strategy', 'project', 'execution']
const VALID_STATUS: Status[] = ['idea', 'todo', 'doing', 'blocked', 'done']
const VALID_KINDS: EdgeKind[] = ['hierarchy', 'depends', 'relates']

async function callClaude(cfg: AiConfig, system: string, user: string, maxTokens = 3000): Promise<string> {
  if (!cfg.apiKey) throw new Error('No API key — add one in Settings to use AI.')
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
  } catch (e) {
    throw new Error(`Network error reaching Anthropic (${e instanceof Error ? e.message : e}). Check your connection.`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('Anthropic rejected the API key (401). Check it in Settings.')
    if (res.status === 429) throw new Error('Rate limited by Anthropic (429). Wait a moment and retry.')
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text: string = data?.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? ''
  if (!text) throw new Error('Empty response from the model.')
  return text
}

/** Pull a JSON object out of a model response, tolerating ``` fences / prose. */
function extractJson<T>(text: string): T {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('The model did not return JSON.')
  try {
    return JSON.parse(t.slice(start, end + 1)) as T
  } catch {
    throw new Error('Could not parse the model response as JSON.')
  }
}

// ---- sanitisers ------------------------------------------------------------

function coerceType(v: unknown): NodeType {
  return VALID_TYPES.includes(v as NodeType) ? (v as NodeType) : 'task'
}
function coerceLevel(v: unknown, fallback: Level = 'project'): Level {
  return VALID_LEVELS.includes(v as Level) ? (v as Level) : fallback
}
function coerceStatus(v: unknown): Status {
  return VALID_STATUS.includes(v as Status) ? (v as Status) : 'idea'
}
function coerceKind(v: unknown): EdgeKind {
  return VALID_KINDS.includes(v as EdgeKind) ? (v as EdgeKind) : 'relates'
}
function cleanProposal(raw: Partial<GraphProposal>): GraphProposal {
  const branches: ProposedBranch[] = Array.isArray(raw.branches)
    ? raw.branches.filter((b) => b && b.tempId && b.name).map((b) => ({ tempId: String(b.tempId), name: String(b.name), color: b.color }))
    : []
  const nodes: ProposedNode[] = Array.isArray(raw.nodes)
    ? raw.nodes
        .filter((n) => n && n.tempId && n.title)
        .map((n) => ({
          tempId: String(n.tempId),
          title: String(n.title),
          body: n.body ? String(n.body) : '',
          type: coerceType(n.type),
          level: coerceLevel(n.level),
          status: coerceStatus(n.status),
          branch: n.branch ? String(n.branch) : undefined,
          time: typeof n.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.time) ? n.time : undefined,
        }))
    : []
  const edges: ProposedEdge[] = Array.isArray(raw.edges)
    ? raw.edges.filter((e) => e && e.from && e.to).map((e) => ({ from: String(e.from), to: String(e.to), kind: coerceKind(e.kind), reason: e.reason }))
    : []
  return { summary: raw.summary ? String(raw.summary) : '', branches, nodes, edges }
}

// ---- feature: organize (reassign) -----------------------------------------

export async function aiOrganize(cfg: AiConfig, nodes: AtlasNode[], branches: Branch[]): Promise<OrganizeResult> {
  const compactNodes = nodes.map((n) => ({ id: n.id, title: n.title, type: n.type, level: n.level, branchId: n.branchId }))
  const branchList = branches.map((b) => ({ id: b.id, name: b.name }))
  const system =
    'You organize a startup strategy map. Nodes live on three altitudes: ' +
    '"strategy" (high-level bets), "project" (deliverables), "execution" (concrete next actions). ' +
    'Each node belongs to one branch (a strategic thread). ' +
    'Propose the SMALLEST set of changes that make the map coherent: move a node to a better altitude or ' +
    'branch only when clearly warranted. Respond with ONLY JSON: ' +
    '{"summary": string, "moves": [{"id": string, "level"?: "strategy"|"project"|"execution", "branchId"?: string, "reason": string}]}.'
  const text = await callClaude(cfg, system, `Branches:\n${JSON.stringify(branchList)}\n\nNodes:\n${JSON.stringify(compactNodes)}`, 2000)
  const parsed = extractJson<OrganizeResult>(text)
  if (!Array.isArray(parsed.moves)) parsed.moves = []
  parsed.moves = parsed.moves.filter((m) => m && m.id && nodes.some((n) => n.id === m.id))
  return parsed
}

// ---- feature: compose from brain-dump -------------------------------------

const ALTITUDE_GUIDE =
  'Altitudes:\n' +
  '- strategy: high-level bets & concepts a founder/exec cares about (e.g. "Win information asymmetry in China").\n' +
  '- project: micro-projects with a concrete deliverable (e.g. "Qualify 3 actuator suppliers").\n' +
  '- execution: the specific next action (e.g. "Email Jeff Monday", "Follow up with Jared").\n' +
  'Node types: strategy, task, info, question, decision. Status: idea, todo, doing, blocked, done.\n' +
  'Edges: "hierarchy" (a higher node CONTAINS a lower one), "depends" (blocker), "relates" (loose link).'

export async function composeFromBrainDump(
  cfg: AiConfig,
  brainDump: string,
  existingBranches: Branch[],
  existingNodes: AtlasNode[],
): Promise<GraphProposal> {
  const branchList = existingBranches.map((b) => ({ id: b.id, name: b.name }))
  const nodeList = existingNodes.map((n) => ({ id: n.id, title: n.title, level: n.level }))
  const system =
    'You convert a founder\'s raw brain-dump into a structured strategy map for the tool "Atlas".\n' +
    ALTITUDE_GUIDE +
    '\nGroup related work into branches (strategic threads). PREFER reusing an existing branch id; only invent a ' +
    'new branch when nothing fits. Create hierarchy edges from higher-altitude parents down to their children. ' +
    'Assign an ISO date (YYYY-MM-DD) only when timing is implied; otherwise omit "time". ' +
    'You MAY link new nodes to existing node ids where clearly related.\n' +
    'Respond with ONLY JSON of this exact shape:\n' +
    '{"summary": string, "branches": [{"tempId": string, "name": string, "color": string}], ' +
    '"nodes": [{"tempId": string, "title": string, "body": string, "type": string, "level": string, "status": string, "branch": string, "time": string}], ' +
    '"edges": [{"from": string, "to": string, "kind": string}]}.\n' +
    '"branch" is an existing branch id OR a branches[].tempId. Edge from/to are node tempIds or existing node ids. ' +
    'Keep it tight and high-signal: roughly 6-18 nodes. Write concise bodies (1-3 sentences).'
  const user =
    `Existing branches:\n${JSON.stringify(branchList)}\n\n` +
    `Existing nodes (for optional linking):\n${JSON.stringify(nodeList)}\n\n` +
    `Brain-dump to structure:\n"""\n${brainDump}\n"""`
  const text = await callClaude(cfg, system, user, 4000)
  return cleanProposal(extractJson<Partial<GraphProposal>>(text))
}

// ---- feature: decompose a node --------------------------------------------

const CHILD_LEVEL: Record<Level, Level> = { strategy: 'project', project: 'execution', execution: 'execution' }

export async function decomposeNode(
  cfg: AiConfig,
  node: AtlasNode,
  branchName: string,
): Promise<GraphProposal> {
  const childLevel = CHILD_LEVEL[node.level]
  const system =
    'You break a single node in a startup strategy map into its immediate sub-steps ONE altitude lower.\n' +
    ALTITUDE_GUIDE +
    `\nThe parent is on the "${node.level}" floor; produce children on the "${childLevel}" floor, all in the SAME branch. ` +
    'Each child gets a hierarchy edge FROM the parent id TO the child tempId. Produce 3-6 concrete, non-overlapping children.\n' +
    'Respond with ONLY JSON: ' +
    '{"summary": string, "nodes": [{"tempId": string, "title": string, "body": string, "type": string, "level": string, "status": string}], ' +
    '"edges": [{"from": string, "to": string, "kind": string}]}. Use the parent id exactly as given for edge "from".'
  const user =
    `Parent node id: ${node.id}\n` +
    `Parent title: ${node.title}\n` +
    `Parent branch: ${branchName}\n` +
    `Parent notes: ${node.body || '(none)'}\n` +
    `Target child altitude: ${childLevel}`
  const text = await callClaude(cfg, system, user, 2500)
  const proposal = cleanProposal(extractJson<Partial<GraphProposal>>(text))
  // Force children into the parent's branch + the intended altitude, and make
  // sure every child is wired to the parent even if the model forgot.
  for (const n of proposal.nodes) {
    n.branch = node.branchId
    n.level = childLevel
    if (!proposal.edges.some((e) => e.to === n.tempId)) {
      proposal.edges.push({ from: node.id, to: n.tempId, kind: 'hierarchy' })
    }
  }
  return proposal
}

// ---- feature: suggest missing connections ---------------------------------

export async function suggestConnections(cfg: AiConfig, nodes: AtlasNode[], existingEdges: { from: string; to: string }[]): Promise<ProposedEdge[]> {
  const compact = nodes.map((n) => ({ id: n.id, title: n.title, level: n.level }))
  const have = existingEdges.map((e) => `${e.from}->${e.to}`)
  const system =
    'You find MISSING relationships between EXISTING nodes in a startup strategy map. Do NOT invent nodes. ' +
    'Only propose high-signal edges. Kinds: "hierarchy" (contains), "depends" (blocker), "relates" (loose link). ' +
    'Respond with ONLY JSON: {"summary": string, "edges": [{"from": string, "to": string, "kind": string, "reason": string}]}. ' +
    'from/to are existing node ids. Max 12 edges. Do not repeat edges that already exist.'
  const user = `Existing nodes:\n${JSON.stringify(compact)}\n\nEdges that already exist (from->to):\n${JSON.stringify(have)}`
  const text = await callClaude(cfg, system, user, 2000)
  const parsed = extractJson<{ edges?: ProposedEdge[] }>(text)
  const ids = new Set(nodes.map((n) => n.id))
  const haveSet = new Set(have)
  return (parsed.edges ?? [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .filter((e) => !haveSet.has(`${e.from}->${e.to}`))
    .map((e) => ({ from: e.from, to: e.to, kind: coerceKind(e.kind), reason: e.reason }))
}
