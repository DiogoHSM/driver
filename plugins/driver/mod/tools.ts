import type { On } from 'claude-code'

import { summarize, type BlockView } from '../src/shared/view.js'
import { project } from '../src/shared/view.js'
import { refusal, runCli, type CliResult, type Dollar } from './cli.js'
import { ensurePoller, forceTick, getAlerts, getPaths, readPlanFresh } from './state.js'

const MODEL_STATUSES = ['in_progress', 'blocked', 'in_review', 'done', 'needs_rework'] as const
const REASON_REQUIRED = new Set<string>(['blocked', 'needs_rework'])
const PLAN_OPS = ['block.add', 'block.set', 'req.add', 'decision.add', 'block.retire', 'req.retire', 'phase.advance'] as const
const DISCOVER_CLASSES = ['XS', 'S', 'M', 'L'] as const
const DISCOVER_STAGES = ['core', 'areas', 'summary', 'closed'] as const
const DISCOVER_CHECKPOINTS = ['none', 'pre-mortem', 'red-team', 'socratic', 'skipped'] as const
const DISCOVER_KINDS = ['fact', 'decision'] as const
const DISCOVER_STATUSES = ['open', 'researching', 'settled', 'assumed', 'deferred'] as const
const DISCOVER_SOURCES = ['user', 'research', 'assumed'] as const
const MAX_OPS = 25
const MAX_DOCS = 30
const DOC_EXCERPT = 1500

export async function registerTools($: Dollar): Promise<void> {
  await $.tool.register({
    name: 'set_block_state',
    isDeferred: false,
    description:
      'Move a DRIVER plan block to a new status (in_progress, blocked, in_review, done, needs_rework). ' +
      'blocked and needs_rework need a reason. Refused moves come back with the reducer\'s explanation. ' +
      'Never moves a block back to not_started and cannot force a transition.',
    inputSchema: {
      type: 'object',
      properties: {
        block: { type: 'string', description: 'Block id, e.g. B-004' },
        status: { type: 'string', enum: [...MODEL_STATUSES] },
        reason: { type: 'string', description: 'Required for blocked and needs_rework' },
        owner: { type: 'string', description: 'Platform agent id; only with in_progress' },
        expectedRevision: { type: 'integer', minimum: 0, description: 'Refuse if the plan revision moved' },
      },
      required: ['block', 'status'],
      additionalProperties: false,
    },
  })
  await $.tool.register({
    name: 'plan_ops',
    isDeferred: false,
    description:
      'Apply 1..25 DRIVER plan edits atomically (one validation, one revision). Ops: block.add, block.set, req.add, ' +
      'decision.add, block.retire, req.retire, phase.advance. "$0", "$1" ... refer to ids created earlier in the same batch. ' +
      'Gate approval, rebaseline and forced moves are not available here.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_OPS,
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: [...PLAN_OPS] } },
            required: ['op'],
            additionalProperties: true,
          },
        },
        expectedRevision: { type: 'integer', minimum: 0 },
      },
      required: ['ops'],
      additionalProperties: false,
    },
  })
  await $.tool.register({
    name: 'plan_status',
    isDeferred: false,
    description:
      'Read the DRIVER plan without running anything: phase, gates, counts, ready blocks (not started, dependencies done, ' +
      'phase reached), blocks in progress with owners, blocked blocks with reasons. scope=phase lists one phase; scope=block ' +
      'returns one block record and an excerpt of its document.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['summary', 'phase', 'block'] },
        phase: { type: 'string', enum: ['discover', 'route', 'implement', 'validate', 'evolve', 'release'] },
        block: { type: 'string' },
      },
      additionalProperties: false,
    },
  })
  await $.tool.register({
    name: 'block_doc',
    isDeferred: false,
    description:
      'Fill sections of block documents (blocks/B-nnn.md) silently, for 1..30 blocks per call. Only the sections you name are ' +
      'rewritten (spec, acceptance as a checklist, notes, handoff); frontmatter, heading and other sections stay. ' +
      'Refused for unknown, retired or done blocks, and then nothing is written. Never edit blocks/B-nnn.md by hand. ' +
      'Does not change the plan or its revision.',
    inputSchema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_DOCS,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Block id, e.g. B-004' },
              spec: { type: 'string', description: 'Text for ## Spec' },
              acceptance: { type: 'array', items: { type: 'string' }, description: 'One criterion per entry; rendered as "- [ ] item"' },
              notes: { type: 'string', description: 'Text for ## Notes' },
              handoff: { type: 'string', description: 'Text for ## Handoff (needed before in_review)' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['blocks'],
      additionalProperties: false,
    },
  })
  await $.tool.register({
    name: 'req_doc',
    isDeferred: false,
    description:
      'Fill sections of requirement documents (requirements/R-nnn.md) silently, for 1..30 requirements per call. Only the sections ' +
      'you name are rewritten (statement, acceptance signal, origin, notes); frontmatter is kept in line with the plan. ' +
      'Refused for unknown or retired requirements, and then nothing is written. Never edit requirements/R-nnn.md by hand. ' +
      'Does not change the plan or its revision.',
    inputSchema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_DOCS,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Requirement id, e.g. R-003' },
              statement: { type: 'string', description: 'Text for ## Statement' },
              acceptance: { type: 'string', description: 'Text for ## Acceptance signal' },
              origin: { type: 'string', description: 'Text for ## Origin' },
              notes: { type: 'string', description: 'Text for ## Notes' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['requirements'],
      additionalProperties: false,
    },
  })
  await $.tool.register({
    name: 'discover_log',
    isDeferred: false,
    description:
      'Record the Discover interview silently and read it back. With meta, nodes and/or nonGoals it appends one entry to ' +
      'discover/interview.jsonl and regenerates interview.md, assumptions.md and non-goals.md (never edit those by hand); the ' +
      'result lists created ids, counts per status and the frontier (open nodes whose dependsOn are settled or assumed). ' +
      'Nodes and nonGoals are updated by id (an absent field keeps its value; no id creates the next Q-nn / N-nn). ' +
      'Creating a node needs question and kind; status assumed needs why and gets an A-nn automatically. ' +
      'With none of the three keys it returns the current state and frontier, for resuming.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            class: { type: 'string', enum: [...DISCOVER_CLASSES] },
            domain: { type: 'string' },
            language: { type: 'string' },
            stage: { type: 'string', enum: [...DISCOVER_STAGES] },
            areas: { type: 'array', items: { type: 'string' }, description: 'Areas offered to the user' },
            chosenAreas: { type: 'array', items: { type: 'string' } },
            reclassified: { type: 'boolean' },
            accepted: { type: 'boolean', description: 'The user accepted the summary; default false' },
            checkpoint: { type: 'string', enum: [...DISCOVER_CHECKPOINTS] },
            batchApplied: { type: 'string', description: 'Ids from the exit batch, e.g. R-001..R-012, D-001' },
          },
          additionalProperties: false,
        },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Q-nn; omit to create the next node' },
              question: { type: 'string' },
              area: { type: 'string', description: 'core or the area name; default core' },
              dependsOn: { type: 'array', items: { type: 'string' }, description: 'Q-nn ids that must exist' },
              kind: { type: 'string', enum: [...DISCOVER_KINDS] },
              status: { type: 'string', enum: [...DISCOVER_STATUSES], description: 'default open' },
              answer: { type: 'string' },
              source: { type: 'string', enum: [...DISCOVER_SOURCES] },
              options: { type: 'array', items: { type: 'string' }, description: 'Options shown to the user' },
              why: { type: 'string', description: 'Required when status is assumed' },
              requirement: { type: 'string', description: 'R-nnn, filled after the exit batch' },
            },
            additionalProperties: false,
          },
        },
        nonGoals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'N-nn; omit to create the next item' },
              statement: { type: 'string' },
              reason: { type: 'string' },
              requirement: { type: 'string', description: 'R-nnn, filled after the exit batch' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  })
}

type Answer ={ result: string } | { deny: string }

const ok = (text: string): Answer => ({ result: text })
const deny = (text: string): Answer => ({ deny: text })

function fromCli(r: CliResult, describe: (json: { revision?: number; created?: unknown }) => string): Answer {
  if (!r.ok) return deny(refusal(r))
  return ok(describe((r.json ?? {}) as { revision?: number; created?: unknown }))
}

const created = (c: unknown): string[] => (Array.isArray(c) ? c.map(String) : typeof c === 'string' ? [c] : [])

const SUBAGENT_REFUSAL = 'DRIVER refused: subagents report to the main session; only the main session writes the plan'

/**
 * `agentId` is set on every tool.call that runs inside a subagent's loop and absent on the main loop.
 * A subagent may write only for a block it owns (block owner equals its agent id, set by the agent.spawn claim).
 */
async function ownsBlocks($: Dollar, agentId: string, ids: string[]): Promise<boolean> {
  const paths = await getPaths($)
  if (!paths) return false
  const read = await readPlanFresh($, paths.driverDir)
  if (read.kind !== 'ok') return false
  return ids.length > 0 && ids.every((id) => read.plan.blocks[id]?.owner === agentId)
}

function actorOf(agentId: string | undefined): string {
  return `model:${agentId ?? 'main'}`
}

function revisionOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
}

interface SetBlockStateInput {
  block?: unknown
  status?: unknown
  reason?: unknown
  owner?: unknown
  expectedRevision?: unknown
}

async function setBlockState($: Dollar, e: SetBlockStateInput & { agentId?: string }): Promise<Answer> {
  const { block, status, reason, owner } = e
  if (typeof block !== 'string' || !/^B-\d+$/.test(block)) return deny('DRIVER refused: block must be an id like B-004')
  if (typeof status !== 'string' || !(MODEL_STATUSES as readonly string[]).includes(status))
    return deny(`DRIVER refused: status must be one of ${MODEL_STATUSES.join(', ')}`)
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (REASON_REQUIRED.has(status) && !why) return deny(`DRIVER refused: ${status} needs a reason`)
  if (e.agentId !== undefined && !(await ownsBlocks($, e.agentId, [block]))) return deny(SUBAGENT_REFUSAL)
  const who = typeof owner === 'string' && owner ? owner : undefined
  if (who && status !== 'in_progress') return deny('DRIVER refused: owner only applies to in_progress')
  const args = ['block', 'status', block, status, ...(why ? [`--reason=${why}`] : []), ...(who ? [`--owner=${who}`] : [])]
  const rev = revisionOf(e.expectedRevision)
  const r = await runCli($, args, { actor: actorOf(e.agentId), ...(rev !== undefined ? { expectRevision: rev } : {}) })
  await forceTick($).catch(() => undefined)
  return fromCli(r, (j) => `ok rev ${j.revision ?? '?'}`)
}

interface PlanOpsInput {
  ops?: unknown
  expectedRevision?: unknown
}

async function planOps($: Dollar, e: PlanOpsInput & { agentId?: string }): Promise<Answer> {
  const { ops } = e
  if (e.agentId !== undefined) return deny(SUBAGENT_REFUSAL)
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) return deny(`DRIVER refused: ops must hold 1 to ${MAX_OPS} entries`)
  for (const [i, o] of ops.entries()) {
    const name = typeof o === 'object' && o !== null ? (o as { op?: unknown }).op : undefined
    if (typeof name !== 'string' || !(PLAN_OPS as readonly string[]).includes(name))
      return deny(`DRIVER refused: op ${i} (${String(name)}) is not available here; allowed: ${PLAN_OPS.join(', ')}`)
  }
  const rev = revisionOf(e.expectedRevision)
  const body = JSON.stringify({ ops, ...(rev !== undefined ? { expectedRevision: rev } : {}) })
  const r = await runCli($, ['apply'], { stdin: body, actor: actorOf(e.agentId) })
  await forceTick($).catch(() => undefined)
  return fromCli(r, (j) => {
    const ids = created(j.created)
    return `ok rev ${j.revision ?? '?'}${ids.length ? `; created ${ids.join(', ')}` : ''}`
  })
}

interface BlockDocInput {
  blocks?: unknown
}

async function blockDoc($: Dollar, e: BlockDocInput & { agentId?: string }): Promise<Answer> {
  const { blocks } = e
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > MAX_DOCS) return deny(`DRIVER refused: blocks must hold 1 to ${MAX_DOCS} entries`)
  if (e.agentId !== undefined) {
    const ids = blocks.map((b) => (typeof b === 'object' && b !== null ? (b as { id?: unknown }).id : undefined))
    if (!ids.every((id): id is string => typeof id === 'string') || !(await ownsBlocks($, e.agentId, ids))) return deny(SUBAGENT_REFUSAL)
  }
  const r = await runCli($, ['block', 'doc'], { stdin: JSON.stringify({ blocks }), actor: actorOf(e.agentId) })
  if (!r.ok) return deny(refusal(r))
  const text = (r.json as { text?: unknown } | undefined)?.text
  return ok(typeof text === 'string' ? text : r.stdout.trim())
}

interface ReqDocInput {
  requirements?: unknown
}

async function reqDoc($: Dollar, e: ReqDocInput & { agentId?: string }): Promise<Answer> {
  const { requirements } = e
  if (e.agentId !== undefined) return deny(SUBAGENT_REFUSAL)
  if (!Array.isArray(requirements) || requirements.length < 1 || requirements.length > MAX_DOCS)
    return deny(`DRIVER refused: requirements must hold 1 to ${MAX_DOCS} entries`)
  const r = await runCli($, ['req', 'doc'], { stdin: JSON.stringify({ requirements }), actor: actorOf(e.agentId) })
  if (!r.ok) return deny(refusal(r))
  const text = (r.json as { text?: unknown } | undefined)?.text
  return ok(typeof text === 'string' ? text : r.stdout.trim())
}

interface DiscoverLogInput {
  meta?: unknown
  nodes?: unknown
  nonGoals?: unknown
}

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Goes through the CLI (the mod cannot import src/discover-log.ts); the CLI validates the fields. */
async function discoverLog($: Dollar, e: DiscoverLogInput & { agentId?: string }): Promise<Answer> {
  const { meta, nodes, nonGoals } = e
  if (meta === undefined && nodes === undefined && nonGoals === undefined) {
    const r = await runCli($, ['discover', 'show'], { actor: actorOf(e.agentId) })
    return r.ok ? ok(r.stdout.trim()) : deny(refusal(r))
  }
  if (e.agentId !== undefined) return deny(SUBAGENT_REFUSAL)
  if (meta !== undefined && !isObject(meta)) return deny('DRIVER refused: meta must be an object')
  if (nodes !== undefined && !Array.isArray(nodes)) return deny('DRIVER refused: nodes must be an array')
  if (nonGoals !== undefined && !Array.isArray(nonGoals)) return deny('DRIVER refused: nonGoals must be an array')
  const body = JSON.stringify({
    ...(meta !== undefined ? { meta } : {}),
    ...(nodes !== undefined ? { nodes } : {}),
    ...(nonGoals !== undefined ? { nonGoals } : {}),
  })
  const r = await runCli($, ['discover', 'log'], { stdin: body, actor: actorOf(e.agentId) })
  if (!r.ok) return deny(refusal(r))
  const text = (r.json as { text?: unknown } | undefined)?.text
  return ok(typeof text === 'string' ? text : r.stdout.trim())
}

interface PlanStatusInput {
  scope?: unknown
  phase?: unknown
  block?: unknown
}

const brief = (b: BlockView) => ({
  id: b.id,
  title: b.title,
  phase: b.phase,
  status: b.status,
  ...(b.owner ? { owner: b.owner } : {}),
  ...(b.reason ? { reason: b.reason } : {}),
  deps: b.deps,
})

/** Reads plan.json through $.fs only: this tool never spawns a process. */
async function planStatus($: Dollar, e: PlanStatusInput): Promise<Answer> {
  const paths = await getPaths($)
  if (!paths) return deny('DRIVER: project root is unknown')
  const read = await readPlanFresh($, paths.driverDir)
  if (read.kind === 'missing') return ok('No DRIVER plan in this project (run /driver init <name>).')
  if (read.kind === 'bad') return deny(`DRIVER: ${read.message}`)
  const view = project(read.plan)
  const sum = summarize(view)
  const head = {
    project: view.project,
    revision: view.revision,
    baseline: view.baseline,
    currentPhase: view.currentPhase,
    gates: view.gates,
  }
  if (e.scope === 'phase') {
    const phase = typeof e.phase === 'string' ? e.phase : view.currentPhase
    return ok(JSON.stringify({ ...head, phase, blocks: view.blocks.filter((b) => b.phase === phase && !b.retired).map(brief) }))
  }
  if (e.scope === 'block') {
    const id = typeof e.block === 'string' ? e.block : ''
    const b = view.blocks.find((x) => x.id === id)
    if (!b) return deny(`DRIVER refused: no block ${id || '(none given)'}`)
    const raw = read.plan.blocks[id]
    let doc = ''
    try {
      doc = ((await $.fs.read(`${paths.driverDir}/blocks/${id}.md`)) as string).slice(0, DOC_EXCERPT)
    } catch {
      // no block document yet
    }
    return ok(JSON.stringify({ ...head, block: { ...brief(b), record: raw, doc } }))
  }
  return ok(
    JSON.stringify({
      ...head,
      counts: sum.counts,
      ready: sum.ready,
      inProgress: sum.inProgress,
      blocked: sum.blocked,
      ...(sum.nextGate ? { nextGate: sum.nextGate } : {}),
      approvals: (await getAlerts($)).length ? 'unverified' : 'trusted',
    }),
  )
}

export function registerToolHooks(on: On): void {
  on('tool.call', { tool: 'mcp__driver__set_block_state' }, async ($, e) => {
    ensurePoller($)
    return setBlockState($, e as SetBlockStateInput & { agentId?: string })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: set_block_state failed unexpectedly' }))

  on('tool.call', { tool: 'mcp__driver__plan_ops' }, async ($, e) => {
    ensurePoller($)
    return planOps($, e as PlanOpsInput & { agentId?: string })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: plan_ops failed unexpectedly' }))

  on('tool.call', { tool: 'mcp__driver__block_doc' }, async ($, e) => {
    ensurePoller($)
    return blockDoc($, e as BlockDocInput & { agentId?: string })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: block_doc failed unexpectedly' }))

  on('tool.call', { tool: 'mcp__driver__req_doc' }, async ($, e) => {
    ensurePoller($)
    return reqDoc($, e as ReqDocInput & { agentId?: string })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: req_doc failed unexpectedly' }))

  on('tool.call', { tool: 'mcp__driver__discover_log' }, async ($, e) => {
    ensurePoller($)
    return discoverLog($, e as DiscoverLogInput & { agentId?: string })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: discover_log failed unexpectedly' }))

  on('tool.call', { tool: 'mcp__driver__plan_status' }, async ($, e) => {
    ensurePoller($)
    return planStatus($, e as PlanStatusInput)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: plan_status failed unexpectedly' }))
}
