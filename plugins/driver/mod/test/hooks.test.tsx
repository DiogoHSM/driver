import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DRIVER_DIR, PANE, PLAN_FILE, ROOT, editPlan, whereReply, world } from './harness.js'
import { WAITLIST_PLAN } from './waitlist.js'

type Plan = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const started = async ($: Engine, on: On, plan: string, cli?: (args: string[]) => { exitCode?: number; stdout?: string; stderr?: string }) => {
  const w = world(on, { [PLAN_FILE]: plan })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : (cli?.(args) ?? { stdout: JSON.stringify({ ok: true, revision: 99 }) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('classic.SubagentStop', () => ({}))
  const clock = mock.clock(on)
  const session = mock.session(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return { w, session, clock }
}

const spawn = (prompt: string) => ({
  tool_use_id: 'toolu_1',
  prompt,
  description: 'work on a block',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' } as const,
  parentModel: 'sonnet',
  background: true,
  fork: false,
})
const claims = (w: ReturnType<typeof world>) => w.cliRuns().filter((r) => r.args[0] === 'block')

test('agent.spawn is denied while the route gate is closed', async ($, on) => {
  const plan = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.gates.route = { approved: false }
    p.currentPhase = 'route'
  })
  const { w } = await started($, on, plan)

  const r = await $.agent.spawn(spawn('DRIVER-BLOCK: B-003 build the landing page'))
  expect(r.deny).toContain('gate route is not approved')
  expect(claims(w)).toHaveLength(0)
})

test('agent.spawn claims a not_started block for the new agent', async ($, on) => {
  const { w } = await started($, on, WAITLIST_PLAN)

  const r = await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))
  expect(r.agentId).toBe('a1')
  const [claim] = claims(w)
  expect(claim!.args).toEqual(['block', 'status', 'B-006', 'in_progress', '--owner', 'a1'])
  expect(claim!.actor).toBe('model:main')
})

test('agent.spawn transfers an in_progress block owned by main', async ($, on) => {
  const plan = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-004'].status = 'in_progress'
    p.blocks['B-004'].owner = 'main'
  })
  const { w } = await started($, on, plan)

  await $.agent.spawn(spawn('DRIVER-BLOCK: B-004 finish the signup API'))
  expect(claims(w)[0]!.args).toEqual(['block', 'owner', 'B-004', 'a1', '--from', 'main'])
})

test('agent.spawn leaves a done block alone and denies a running owner', async ($, on) => {
  const plan = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-004'].status = 'in_progress'
    p.blocks['B-004'].owner = 'a0'
  })
  const { w } = await started($, on, plan)

  expect(((await $.agent.spawn(spawn('DRIVER-BLOCK: B-003 touch up'))).agentId)).toBe('a1')
  expect(claims(w)).toHaveLength(0)

  w.agents = [{ id: 'a0', status: 'running' }]
  const denied = await $.agent.spawn(spawn('DRIVER-BLOCK: B-004 take over'))
  expect(denied.deny).toContain('already in progress under agent a0')

  w.agents = [{ id: 'a0', status: 'completed' }]
  await $.agent.spawn(spawn('DRIVER-BLOCK: B-004 take over'))
  expect(claims(w)[0]!.args).toEqual(['block', 'owner', 'B-004', 'a1', '--from', 'a0'])
})

test('agent.spawn denies a blocked block that waits on unfinished dependencies or is held by something else', async ($, on) => {
  const plan = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-006'].status = 'blocked'
    p.blocks['B-006'].statusReason = 'waiting on B-004'
  })
  const { w } = await started($, on, plan)

  const denied = await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))
  expect(denied.deny).toContain('B-006 is blocked and waits on B-004, B-005')
  expect(claims(w)).toHaveLength(0)

  // B-005 is blocked on a missing credential (not a named wait): its dependency B-003 is done, but an agent cannot supply the credential
  const held = await $.agent.spawn(spawn('DRIVER-BLOCK: B-005 send the confirmation email'))
  expect(held.deny).toContain('B-005 is blocked (Waiting for RESEND_API_KEY')
  expect(held.deny).toContain('an agent cannot unblock it')
  expect(claims(w)).toHaveLength(0)
})

test('agent.spawn denies a block blocked for a reason that only mentions another block, and claims one whose named wait is done', async ($, on) => {
  const mentions = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-006'].status = 'blocked'
    p.blocks['B-006'].statusReason = 'missing STRIPE_KEY (needed by B-005 checkout)'
    p.blocks['B-004'].status = 'done'
    p.blocks['B-005'].status = 'done'
  })
  const first = await started($, on, mentions)
  const denied = await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))
  expect(denied.deny).toContain('B-006 is blocked (missing STRIPE_KEY (needed by B-005 checkout))')
  expect(claims(first.w)).toHaveLength(0)
})

test('agent.spawn claims a blocked block whose named dependency is done, and blocks that need rework or have not started as before', async ($, on) => {
  const resumed = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-006'].status = 'blocked'
    p.blocks['B-006'].statusReason = 'waiting on B-004'
    p.blocks['B-004'].status = 'done'
    p.blocks['B-005'].status = 'done'
  })
  const { w } = await started($, on, resumed)
  const ok = await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))
  expect(ok.agentId).toBe('a1')
  expect(claims(w)[0]!.args).toEqual(['block', 'status', 'B-006', 'in_progress', '--owner', 'a1'])
})

test('agent.spawn claims a block that needs rework', async ($, on) => {
  const rework = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.blocks['B-005'].status = 'needs_rework'
    p.blocks['B-005'].statusReason = 'criterion 2 fails'
  })
  const { w } = await started($, on, rework)
  const ok = await $.agent.spawn(spawn('DRIVER-BLOCK: B-005 fix it'))
  expect(ok.agentId).toBe('a1')
  expect(claims(w)[0]!.args).toEqual(['block', 'status', 'B-005', 'in_progress', '--owner', 'a1'])
})

test('agent.spawn denies when the plan cannot be read, and passes when there is none', async ($, on) => {
  const { w } = await started($, on, '{ not json')
  const r = await $.agent.spawn(spawn('anything'))
  expect(r.deny).toContain('refusing to start agents')

  w.files.delete(PLAN_FILE)
  expect((await $.agent.spawn(spawn('anything'))).agentId).toBe('a1')
})

test('a failed claim toasts and tells the orchestrator', async ($, on) => {
  const { w, session } = await started($, on, WAITLIST_PLAN, () => ({ exitCode: 1, stdout: JSON.stringify({ ok: false, error: 'B-006 depends on B-004' }) }))

  const r = await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))
  expect(r.agentId).toBe('a1')
  expect(w.toasts.join('\n')).toContain('could not record that agent a1 works on B-006')
  const rows = session.appended()
  expect(rows).toHaveLength(1)
  expect(JSON.stringify(rows[0]!.message)).toContain('B-006 depends on B-004')
})

test('SubagentStop drops the claim and warns when the block ended blocked', async ($, on) => {
  const { w } = await started($, on, WAITLIST_PLAN)
  await $.agent.spawn(spawn('DRIVER-BLOCK: B-006 run the e2e check'))

  // what the shell hook does when an agent stops with work left
  w.files.set(PLAN_FILE, editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.revision = 35
    p.blocks['B-006'].status = 'blocked'
    p.blocks['B-006'].statusReason = 'agent a1 ended without finishing'
  }))
  w.touch()
  const stop = { stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'general-purpose' }
  await $.classic.SubagentStop(stop)
  expect(w.toasts.filter((t) => t.includes('B-006 is blocked'))).toHaveLength(1)

  // the claim is gone: a second stop of the same agent says nothing
  await $.classic.SubagentStop(stop)
  expect(w.toasts.filter((t) => t.includes('B-006 is blocked'))).toHaveLength(1)
})

test('Write and Bash to the plan are denied, however the path is spelled or linked', async ($, on) => {
  const { w } = await started($, on, WAITLIST_PLAN)
  w.real = (p) => (p.startsWith('/proj/innocent') ? p.replace('/proj/innocent', DRIVER_DIR) : p)
  w.files.set('/proj/innocent/keep', '')

  const denied = async (call: Record<string, unknown>) => (await $.tool.call(call as never)).deny
  // the review's forgery: cd hides the directory name, a glob hides the rest, then the ticket is written
  expect(await denied({ tool: 'Bash', command: "cd .claude && cd dri?er && printf '{}' > .mod/ticket.json && cd ../.." })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'printf x | node /p/dist/cli.js gate --via-mod approve release --actor user:diogo' })).toContain('user-only')
  expect(await denied({ tool: 'Bash', command: 'patch .claude/driver/plan.json < /tmp/p' })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'tar xf /tmp/a.tar -C .claude/driver' })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'git reset --hard -- .claude/driver' })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'echo {} > /tmp/anywhere/plan.json' })).toContain('driver CLI')
  expect(await denied({ tool: 'Write', file_path: '/proj/.Claude/Driver/plan.json', content: '{}' })).toContain('written only by the driver CLI')
  expect(await denied({ tool: 'Edit', file_path: `${DRIVER_DIR}/events.jsonl`, old_string: 'a', new_string: 'b' })).toContain('driver CLI')
  expect(await denied({ tool: 'Write', file_path: `${DRIVER_DIR}/.mod/ticket.json`, content: '{}' })).toContain('driver CLI')
  expect(await denied({ tool: 'Write', file_path: '/proj/innocent/plan.json', content: '{}' })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'echo {} > .claude/driver/plan.json' })).toContain('driver CLI')
  expect(await denied({ tool: 'Bash', command: 'driver gate approve release' })).toContain('user-only')

  for (const f of ['blocks/B-004.md', 'requirements/R-001.md', 'decisions/D-001.md', 'discover/interview.md'])
    expect((await $.tool.call({ tool: 'Write', file_path: `${DRIVER_DIR}/${f}`, content: 'notes' } as never)).deny, f).toBeUndefined()
  for (const command of ['jq . .claude/driver/plan.json > /tmp/x', 'git status && git diff && git log --oneline', 'ls .claude/driverless.txt', 'driver status --json'])
    expect((await $.tool.call({ tool: 'Bash', command } as never)).deny, command).toBeUndefined()

  const ok = await $.tool.call({ tool: 'Write', file_path: '/proj/src/index.ts', content: 'x' } as never)
  expect(ok.deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'cat .claude/driver/plan.json' } as never)).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: `${DRIVER_DIR}/blocks/B-004.md`, content: 'notes' } as never)).deny).toBeUndefined()
})

test('where there is no plan, the guards deny nothing', async ($, on) => {
  const w = world(on)
  w.cli = (args) => (args[0] === 'where' ? whereReply(false) : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  mock.clock(on)
  await $.session.start({ cwd: '/tmp/scratch', surface: 'terminal', isInteractive: true })

  for (const command of ['socat TCP-LISTEN:8080 TCP:localhost:3000', 'script -q /dev/null ls', 'echo {} > .claude/driver/plan.json', 'node ./bin/cli.js --port $PORT', 'git reset --hard', 'git stash'])
    expect((await $.tool.call({ tool: 'Bash', command } as never)).deny, command).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/proj/.claude/driver/plan.json', content: '{}' } as never)).deny).toBeUndefined()

  // the plan appears (driver init in another terminal): the guard follows without a restart
  w.files.set(PLAN_FILE, WAITLIST_PLAN)
  expect((await $.tool.call({ tool: 'Write', file_path: '/proj/.claude/driver/plan.json', content: '{}' } as never)).deny).toContain('driver CLI')
})

test('a resumed agent meets the same gate, on the message that wakes it', async ($, on) => {
  const closed = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.gates.release = { approved: false }
    p.currentPhase = 'release'
  })
  const { w } = await started($, on, closed)
  const resume = { ...spawn('DRIVER-BLOCK: B-008 deploy now'), resume: { agentId: 'a0' } }

  expect((await $.agent.spawn(resume)).deny).toContain('gate release is not approved')

  w.files.set(PLAN_FILE, editPlan(closed, (p: Plan) => {
    p.gates.release = { approved: true }
  }))
  w.touch()
  expect((await $.agent.spawn(resume)).agentId).toBe('a1')
  expect(claims(w)).toHaveLength(0) // a resume never claims
})

test('two parallel spawns for one block: the second is refused', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : { stdout: JSON.stringify({ ok: true, revision: 99 }) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', async () => {
    await clock.sleep(10)
    return { model: 'sonnet', agentId: `a${++n}` }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const first = $.agent.spawn(spawn('DRIVER-BLOCK: B-006 one'))
  const second = $.agent.spawn(spawn('DRIVER-BLOCK: B-006 two'))
  await clock.advance(20)
  const results = await Promise.all([first, second])
  expect(results.filter((r) => r.deny?.includes('being claimed by another spawn'))).toHaveLength(1)
  expect(results.filter((r) => r.agentId)).toHaveLength(1)
  expect(claims(w)).toHaveLength(1)

  // the lock is released: a later spawn is judged on the plan again
  const third = $.agent.spawn(spawn('DRIVER-BLOCK: B-006 three'))
  await clock.advance(20)
  expect((await third).deny).toBeUndefined()
})

test('an approval through the mod that this session never issued raises an alarm', async ($, on) => {
  const { w, session } = await started($, on, WAITLIST_PLAN)
  const forged = editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.revision = 35
    p.gates.release = { approved: true, approvedBy: 'diogo', approvedAt: '2026-10-28T10:00:00Z', atBaseline: 1, approvedVia: 'mod', approvedTicket: 'f'.repeat(64) }
  })
  w.files.set(PLAN_FILE, forged)
  w.touch()
  await $.command.run({ command: 'driver', args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)

  expect(w.toasts.join('\n')).toContain('gate release approval not issued by this session')
  expect(JSON.stringify(session.appended())).toContain('never issued')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /not issued by this session/ }))?.props.color).toBe('red')
  await ui.unmount()
})

const approvedRelease = (via: string | undefined, extra: Record<string, unknown> = {}) =>
  editPlan(WAITLIST_PLAN, (p: Plan) => {
    p.revision = 35
    p.gates.release = { approved: true, approvedBy: 'diogo', approvedAt: '2026-10-28T10:00:00Z', atBaseline: 1, ...(via ? { approvedVia: via } : {}), ...extra }
  })

const status = ($: Engine) =>
  $.command.run({ command: 'driver', args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)

test('an approval typed in a terminal is announced, with no banner', async ($, on) => {
  const { w, session } = await started($, on, WAITLIST_PLAN)
  w.files.set(PLAN_FILE, approvedRelease('tty'))
  w.touch()
  await status($)

  expect(w.toasts.join('\n')).toContain('gate release approved in a terminal by diogo')
  expect(session.appended()).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /not issued/ })).toBeUndefined()
  await ui.unmount()
})

test('an approval that says nothing about how it came is an alarm, mid-session and at start', async ($, on) => {
  const { w, session } = await started($, on, WAITLIST_PLAN)
  w.files.set(PLAN_FILE, approvedRelease(undefined))
  w.touch()
  await status($)
  expect(w.toasts.join('\n')).toContain('gate release approval not issued by this session (via: none)')
  expect(session.appended()).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /via: none/ }))?.props.color).toBe('red')
  await ui.unmount()
})

test('a plan already approved without approvedVia raises the banner at session start, once', async ($, on) => {
  const { w } = await started($, on, approvedRelease(undefined))
  expect(w.toasts.filter((t) => t.includes('via: none'))).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /via: none/ })).toBeDefined()
  await ui.unmount()
})

test('a forged mod ticket (node -e style) raises the banner and plan_status says unverified', async ($, on) => {
  const { w } = await started($, on, WAITLIST_PLAN)
  const before = JSON.parse(String((await $.tool.call({ tool: 'mcp__driver__plan_status' } as never)).result))
  expect(before.approvals).toBe('trusted')
  w.files.set(PLAN_FILE, approvedRelease('mod', { approvedTicket: 'e'.repeat(64) }))
  w.touch()
  await status($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /via: mod/ })).toBeDefined()
  await ui.unmount()
  const after = JSON.parse(String((await $.tool.call({ tool: 'mcp__driver__plan_status' } as never)).result))
  expect(after.approvals).toBe('unverified')
})

test('xargs does not hide a write, and git cannot rewrite the tree where a plan exists', async ($, on) => {
  await started($, on, WAITLIST_PLAN)
  const deny = async (command: string) => (await $.tool.call({ tool: 'Bash', command } as never)).deny
  expect(await deny('echo x | xargs -I{} cp {} .claude/driver/.mod/ticket.json')).toContain('driver CLI')
  expect(await deny('git reset --hard')).toContain('can rewrite .claude/driver')
  expect(await deny('git stash')).toContain('can rewrite')
  expect(await deny('git reset HEAD -- src/a.ts')).toBeUndefined()
})
