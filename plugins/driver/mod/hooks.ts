import type { On } from 'claude-code'

import { blockMarker, gateVerdict } from '../src/shared/gate.js'
import { protectCommand, protectPath } from '../src/shared/protect.js'
import type { DriverClaim } from '../types'
import { runCli, type Dollar } from './cli.js'
import { ensurePoller, forceTick, getClaims, getPaths, getStoredPaths, getView, readPlanFresh, updateClaims } from './state.js'

const FAIL_CLOSED_SPAWN = 'DRIVER: the agent gate failed unexpectedly, so the agent was not started. Check the plan with "driver validate".'
const FAIL_CLOSED_TOOL = 'DRIVER: the protection check failed unexpectedly, so this call was not run.'

// ---------------------------------------------------------------- agent.spawn

async function runningAgents($: Dollar): Promise<Set<string>> {
  const list = await $.agent.list()
  return new Set(list.filter((a) => a.status === 'running').map((a) => a.id))
}

async function reportClaimFailure($: Dollar, agentId: string, block: string, why: string): Promise<void> {
  const text = `DRIVER: could not record that agent ${agentId} works on ${block}: ${why}. The plan does not show it as in progress; update it with set_block_state.`
  $.ui.toast(text)
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } catch {
    // the toast already said it
  }
}

async function claim($: Dollar, agentId: string, block: string, status: string, owner: string | undefined, actor: string): Promise<void> {
  let args: string[] | undefined
  if (status === 'not_started' || status === 'needs_rework' || status === 'blocked')
    args = ['block', 'status', block, 'in_progress', '--owner', agentId]
  else if (status === 'in_progress' && owner && owner !== agentId) args = ['block', 'owner', block, agentId, '--from', owner]
  if (!args) return
  const r = await runCli($, args, { actor })
  if (!r.ok) return reportClaimFailure($, agentId, block, r.error)
  const now = await $.clock.now()
  await updateClaims($, (c) => ({ ...c, [agentId]: { block, at: now } satisfies DriverClaim }))
  await forceTick($)
}

/** Blocks whose spawn is between the contention check and the claim. */
const pendingClaims = new Set<string>()

export function resetPending(): void {
  pendingClaims.clear()
}

export function registerSpawnGuard(on: On): void {
  on('agent.spawn', async ($, e, next) => {
    ensurePoller($)
    const paths = await getPaths($)
    if (!paths) return next(e)
    const planRead = await readPlanFresh($, paths.driverDir)
    if (planRead.kind === 'missing') return next(e)
    if (planRead.kind === 'bad') return { deny: `DRIVER: ${planRead.message}; refusing to start agents until the plan is readable.` }
    const plan = planRead.plan

    // A resumed agent gets the same gate check, on the message that wakes it (deny only, never a claim).
    const text = `${e.prompt}\n${e.description}`
    const verdict = gateVerdict(plan, text)
    if (!verdict.allow) return { deny: verdict.reason }
    if (e.resume) return next(e)

    const blockId = blockMarker(text)
    const block = blockId ? plan.blocks[blockId] : undefined
    if (block && block.status === 'in_progress' && block.owner && block.owner !== 'main' && block.owner !== e.parentAgentId) {
      if ((await runningAgents($)).has(block.owner))
        return { deny: `DRIVER: ${blockId} is already in progress under agent ${block.owner}, which is still running.` }
    }

    // Parallel spawns for one block (a Workflow's agent() calls) must not both pass the check above.
    const needsClaim = !!blockId && !!block && block.status !== 'done' && block.status !== 'in_review'
    if (needsClaim && pendingClaims.has(blockId)) return { deny: `DRIVER: ${blockId} is being claimed by another spawn; wait for it or pick another block.` }
    if (needsClaim) pendingClaims.add(blockId)
    try {
      const spawned = await next(e)
      if (spawned.deny !== undefined || !spawned.agentId || !blockId || !block) return spawned
      try {
        await claim($, spawned.agentId, blockId, block.status, block.owner, `model:${e.parentAgentId ?? 'main'}`)
      } catch (err) {
        await reportClaimFailure($, spawned.agentId, blockId, (err as Error).message)
      }
      return spawned
    } finally {
      if (needsClaim) pendingClaims.delete(blockId)
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FAIL_CLOSED_SPAWN }))

  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    try {
      const claims = await getClaims($)
      const mine = claims[e.agent_id]
      if (mine) {
        await updateClaims($, (c) => {
          const { [e.agent_id]: _gone, ...rest } = c
          return rest
        })
        await forceTick($)
        const view = await getView($)
        if (view?.blocks.find((b) => b.id === mine.block)?.status === 'blocked')
          $.ui.toast(`DRIVER: ${mine.block} is blocked: its agent ended without finishing.`)
      }
    } catch {
      // the redraw is best effort; the shell hook already wrote the orphan state
    }
    return result
  })
}

// ---------------------------------------------------------------- tool.call guard

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'))

/** Where `path` lands once symlinks resolve, even if the file does not exist yet: the nearest existing ancestor's real path plus the rest. */
async function placed($: Dollar, path: string): Promise<string | undefined> {
  let abs = path
  if (!abs.startsWith('/')) abs = `${(await $.session.cwd()).replace(/\/+$/, '')}/${abs}`
  const rest: string[] = []
  let cur = abs
  for (let i = 0; i < 64 && cur.length > 0; i++) {
    try {
      const st = await $.fs.stat(cur, { resolve: true })
      if (st.realPath) return [st.realPath.replace(/\/+$/, ''), ...rest.reverse()].join('/')
    } catch {
      // missing: try the parent
    }
    rest.push(cur.slice(cur.lastIndexOf('/') + 1))
    cur = dirOf(cur)
  }
  return undefined
}

async function realDriverDir($: Dollar, driverDir: string): Promise<string> {
  try {
    return (await $.fs.stat(driverDir, { resolve: true })).realPath ?? driverDir
  } catch {
    return driverDir
  }
}

/** The guard only applies where a DRIVER plan exists (state first, then a fresh look at the session cwd). */
async function hasPlan($: Dollar): Promise<boolean> {
  try {
    const stored = await getStoredPaths($)
    if (stored?.planExists) return true
    const cwd = (await $.session.cwd()).replace(/\/+$/, '')
    const dirs = [...(stored ? [stored.driverDir] : []), `${cwd}/.claude/driver`]
    for (const dir of dirs) if (await $.fs.exists(`${dir}/plan.json`)) return true
    return false
  } catch {
    return true // cannot tell: stay guarded
  }
}

export function registerToolGuard(on: On): void {
  // A RegExp, not a list: MultiEdit exists in some builds only.
  on('tool.call', { tool: /^(Write|Edit|MultiEdit|Bash)$/ }, async ($, e, next) => {
    ensurePoller($)
    if (!(await hasPlan($))) return next(e)
    const args = e as { command?: unknown; file_path?: unknown }
    if (String(e.tool) === 'Bash') {
      const reason = protectCommand(typeof args.command === 'string' ? args.command : '')
      return reason ? { deny: reason } : next(e)
    }
    const file = typeof args.file_path === 'string' ? args.file_path : ''
    if (!file) return next(e)
    let opts: { realPath?: string; driverDir?: string } = {}
    try {
      const paths = await getPaths($)
      if (paths) {
        const real = await placed($, file)
        opts = { ...(real ? { realPath: real } : {}), driverDir: await realDriverDir($, paths.driverDir) }
      }
    } catch {
      // fall back to the spelling-only check below
    }
    const reason = protectPath(file, opts)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FAIL_CLOSED_TOOL }))
}
