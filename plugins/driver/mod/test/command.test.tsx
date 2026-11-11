import { expect, mock, test } from 'claude-code/testing'

import { DRIVER_DIR, PANE, PLAN_FILE, ROOT, editPlan, whereReply, world } from './harness.js'
import { WAITLIST_PLAN } from './waitlist.js'

const PRESENTATION = { isFullscreen: false, columns: 80 }
const typed = (args: string, origin: { kind: 'composer' } | { kind: 'plugin'; name: string }) =>
  ({ command: 'driver', args, origin, presentation: PRESENTATION }) as never

test('/driver approve is refused unless the person typed it', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : { stdout: JSON.stringify({ ok: true, revision: 35 }) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on, { now: 5_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  for (const origin of [{ kind: 'plugin', name: 'someone' }, { kind: 'sdk' }, { kind: 'bridge' }] as const) {
    const r = await $.command.run(typed('approve release', origin as never))
    expect(r.text).toContain('must be typed by you')
  }
  expect(w.writes).toHaveLength(0)
  expect(w.cliRuns().some((r) => r.args.includes('gate'))).toBe(false)
})

test('/driver approve from the composer writes a ticket and hands the nonce over on stdin', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : { stdout: JSON.stringify({ ok: true, revision: 35 }) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on, { now: 5_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const r = await $.command.run(typed('approve release', { kind: 'composer' }))
  expect(r.text).toBe('Approved gate release at revision 34. Started release. Claude takes it from here.')
  expect(w.prompts).toHaveLength(0)
  await clock.advance(60)
  expect(w.prompts).toEqual([expect.stringContaining('approved the release gate')])
  expect(r.context).toEqual(['User approved gate release via /driver at rev 34'])

  expect(w.writes).toHaveLength(1)
  const ticket = JSON.parse(w.writes[0]!.text) as { gate: string; revision: number; sha256: string; exp: number }
  expect(w.writes[0]!.path).toBe(`${DRIVER_DIR}/.mod/ticket.json`)
  expect(ticket).toMatchObject({ gate: 'release', revision: 34, exp: 20_000 })
  const call = w.cliRuns().find((x) => x.args.includes('gate'))!
  expect(call.args).toEqual(['gate', 'approve', 'release', '--via-mod'])
  expect(call.actor).toMatch(/^user:/)
  expect(call.stdin).toMatch(/^[0-9a-f]{64}$/)
  expect(call.full.join(' ')).not.toContain(call.stdin!)
  expect(w.writes[0]!.text).not.toContain(call.stdin!)
  expect(ticket.sha256).not.toBe(call.stdin)
})

test('/driver approve refuses a stale or unknown gate and surfaces the CLI refusal', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) =>
    args[0] === 'where'
      ? whereReply()
      : { exitCode: 2, stdout: JSON.stringify({ ok: false, error: 'plan changed since the ticket was issued' }) }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  expect((await $.command.run(typed('approve nothing', { kind: 'composer' }))).text).toContain('Usage')
  expect((await $.command.run(typed('approve route', { kind: 'composer' }))).text).toBe('Gate route is already approved.')
  const refused = await $.command.run(typed('approve release', { kind: 'composer' }))
  expect(refused.text).toBe('DRIVER refused: plan changed since the ticket was issued')
  expect(refused.context).toBeUndefined()
})

test('/driver status, export and init', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN, [`${DRIVER_DIR}/exports/plan.mmd`]: 'flowchart LR\n  B-001 --> B-002\n' })
  w.cli = (args) => {
    if (args[0] === 'where') return whereReply()
    if (args[0] === 'export') return { stdout: JSON.stringify({ ok: true, path: `${DRIVER_DIR}/exports/plan.mmd` }) }
    return { stdout: JSON.stringify({ ok: true }) }
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const status = await $.command.run(typed('', { kind: 'composer' }))
  expect(status.text).toContain('DRIVER web-waitlist: phase implement, revision 34, baseline 1')
  expect(status.text).toContain('gates: route approved (diogo); release pending')
  expect(status.text).toContain('blocked: B-005')

  const exported = await $.command.run(typed('export', { kind: 'composer' }))
  expect(exported.text).toContain('```mermaid\nflowchart LR')

  await $.command.run(typed('init my project', { kind: 'composer' }))
  expect(w.cliRuns().find((x) => x.args[0] === 'init')!.args).toEqual(['init', 'my project'])
})

test('node is found through a login shell when the app PATH lacks it, and cached', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN }, {})
  w.exec = (argv) => {
    if (argv[0] === 'node') return 'spawn node ENOENT'
    if (argv[0] === '/bin/zsh') return { stdout: '/opt/homebrew/bin/node\n' }
    return undefined
  }
  w.cli = (args) => (args[0] === 'where' ? whereReply() : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const runs = w.runs.filter((r) => r.argv[1]?.endsWith('/dist/cli.js'))
  expect(runs[0]!.argv[0]).toBe('/opt/homebrew/bin/node')
  expect(w.runs.filter((r) => r.argv[0] === '/bin/zsh')).toHaveLength(1)
  await $.command.run(typed('status', { kind: 'composer' }))
  await $.command.run(typed('init again', { kind: 'composer' }))
  expect(w.runs.filter((r) => r.argv[0] === '/bin/zsh')).toHaveLength(1)
})

test('the poller re-reads plan.json only when it changed', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const reads = () => w.reads.filter((p) => p === PLAN_FILE).length
  const first = reads()

  await clock.advance(3000)
  expect(reads()).toBe(first)

  w.files.set(PLAN_FILE, editPlan(WAITLIST_PLAN, (p: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    p.revision = 35
  }))
  w.touch()
  await clock.advance(1000)
  expect(reads()).toBe(first + 1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /rev 35/ }))?.text).toContain('rev 35')
  await ui.unmount()
})
