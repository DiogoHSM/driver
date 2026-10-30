import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DRIVER_DIR, PLAN_FILE, ROOT, whereReply, world } from './harness.js'
import { WAITLIST_PLAN } from './waitlist.js'

const TOOL = (name: string) => `mcp__driver__${name}` as const

// the plugin's own tools are not in the engine's static tool table
type ToolReply = { result?: any; deny?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const callTool = ($: Engine, input: Record<string, unknown>): Promise<ToolReply> => ($.tool as unknown as { call: (x: unknown) => Promise<ToolReply> }).call(input)

test('set_block_state runs block status with the model actor and the expected revision', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) =>
    args[0] === 'where' ? whereReply() : args[0] === 'block' ? { stdout: JSON.stringify({ ok: true, revision: 35 }) } : {}
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const r = await callTool($, { tool: TOOL('set_block_state'), block: 'B-004', status: 'done', expectedRevision: 34 })
  expect(r.result).toBe('ok rev 35')
  const run = w.cliRuns().find((x) => x.args[0] === 'block')!
  expect(run.args).toEqual(['block', 'status', 'B-004', 'done'])
  expect(run.actor).toBe('model:main')
  expect(run.full).toContain('--expect-revision')
  expect(run.full).toContain('--root')

  await callTool($, { tool: TOOL('set_block_state'), block: 'B-005', status: 'blocked', reason: 'waiting on DNS' })
  const blocked = w.cliRuns().filter((x) => x.args[0] === 'block')[1]!
  expect(blocked.args).toEqual(['block', 'status', 'B-005', 'blocked', '--reason=waiting on DNS'])
})

test('set_block_state refuses what the contract excludes, before any process runs', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const before = w.cliRuns().length

  expect((await callTool($, { tool: TOOL('set_block_state'), block: 'B-004', status: 'not_started' })).deny).toContain('status must be one of')
  expect((await callTool($, { tool: TOOL('set_block_state'), block: 'B-005', status: 'blocked' })).deny).toContain('needs a reason')
  expect((await callTool($, { tool: TOOL('set_block_state'), block: 'B-005', status: 'done', owner: 'a1' })).deny).toContain('only applies to in_progress')
  expect((await callTool($, { tool: TOOL('set_block_state'), block: 'nope', status: 'done' })).deny).toContain('like B-004')
  expect(w.cliRuns().length).toBe(before)
})

test('a CLI refusal comes back as a deny with the CLI text', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) =>
    args[0] === 'where'
      ? whereReply()
      : { exitCode: 1, stdout: JSON.stringify({ ok: false, error: 'B-006 depends on B-004 which is not done' }), stderr: 'driver: B-006 depends on B-004 which is not done' }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const r = await callTool($, { tool: TOOL('set_block_state'), block: 'B-006', status: 'in_progress' })
  expect(r.deny).toBe('DRIVER refused: B-006 depends on B-004 which is not done')
})

test('plan_ops sends the batch on stdin, back-references included', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN })
  w.cli = (args) =>
    args[0] === 'where' ? whereReply() : args[0] === 'apply' ? { stdout: JSON.stringify({ ok: true, revision: 36, created: ['B-009', 'B-010'] }) } : {}
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const ops = [
    { op: 'block.add', title: 'Rate limit', phase: 'implement' },
    { op: 'block.add', title: 'Rate limit tests', phase: 'validate', dependsOn: ['$0'] },
  ]
  const r = await callTool($, { tool: TOOL('plan_ops'), ops, expectedRevision: 35 })
  expect(r.result).toBe('ok rev 36; created B-009, B-010')
  const run = w.cliRuns().find((x) => x.args[0] === 'apply')!
  expect(JSON.parse(run.stdin!)).toEqual({ ops, expectedRevision: 35 })
  expect(run.stdin).toContain('"$0"')

  const bad = await callTool($, { tool: TOOL('plan_ops'), ops: [{ op: 'gate.approve', gate: 'route' }] })
  expect(bad.deny).toContain('not available here')
  const many = await callTool($, { tool: TOOL('plan_ops'), ops: Array.from({ length: 26 }, () => ({ op: 'phase.advance' })) })
  expect(many.deny).toContain('1 to 25')
})

test('plan_status reads the plan without spawning anything', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: WAITLIST_PLAN, [`${DRIVER_DIR}/blocks/B-004.md`]: '# B-004\n\nSignup API notes' })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const before = w.runs.length

  const summary = JSON.parse(String((await callTool($, { tool: TOOL('plan_status') })).result))
  expect(summary).toMatchObject({ revision: 34, currentPhase: 'implement', nextGate: 'release' })
  expect(summary.blocked).toEqual([{ id: 'B-005', reason: expect.stringContaining('RESEND_API_KEY') }])
  const phase = JSON.parse(String((await callTool($, { tool: TOOL('plan_status'), scope: 'phase', phase: 'implement' })).result))
  expect(phase.blocks.map((b: { id: string }) => b.id)).toEqual(['B-003', 'B-004', 'B-005'])
  const block = JSON.parse(String((await callTool($, { tool: TOOL('plan_status'), scope: 'block', block: 'B-004' })).result))
  expect(block.block.doc).toContain('Signup API notes')
  expect(block.block.record.status).toBe('in_review')
  expect(w.runs.length).toBe(before)
})
