import type { On } from 'claude-code'

import { summarize, type BlockView } from '../src/shared/view.js'
import { project } from '../src/shared/view.js'
import { refusal, runCli, type CliResult, type Dollar } from './cli.js'
import { ensurePoller, forceTick, getAlerts, getPaths, readPlanFresh } from './state.js'

const MODEL_STATUSES = ['in_progress', 'blocked', 'in_review', 'done', 'needs_rework'] as const
const REASON_REQUIRED = new Set<string>(['blocked', 'needs_rework'])
const PLAN_OPS = ['block.add', 'block.set', 'req.add', 'decision.add', 'block.retire', 'req.retire', 'phase.advance'] as const
const MAX_OPS = 25
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
}

type Answer = { result: string } | { deny: string }

const ok = (text: string): Answer => ({ result: text })
const deny = (text: string): Answer => ({ deny: text })

function fromCli(r: CliResult, describe: (json: { revision?: number; created?: unknown }) => string): Answer {
  if (!r.ok) return deny(refusal(r))
  return ok(describe((r.json ?? {}) as { revision?: number; created?: unknown }))
}

const created = (c: unknown): string[] => (Array.isArray(c) ? c.map(String) : typeof c === 'string' ? [c] : [])

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

  on('tool.call', { tool: 'mcp__driver__plan_status' }, async ($, e) => {
    ensurePoller($)
    return planStatus($, e as PlanStatusInput)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'DRIVER: plan_status failed unexpectedly' }))
}
