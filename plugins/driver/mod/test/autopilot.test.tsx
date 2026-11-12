import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE, PLAN_FILE, ROOT, editPlan, loopPlan, whereReply, world } from './harness.js'
import { WAITLIST_PLAN } from './waitlist.js'

const PRESENTATION = { isFullscreen: false, columns: 80 }
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
const typed = (args: string, origin: { kind: 'composer' } | { kind: 'plugin'; name: string }) =>
  ({ command: 'driver', args, origin, presentation: PRESENTATION }) as never
const ended = (reason: 'answer' | 'aborted', agentId?: string) =>
  ({ answer: 'done', durationMs: 1, isAborted: reason === 'aborted', turnId: 't1', reason, ...(agentId ? { agentId } : {}) }) as never

// B-004 in review and B-005 blocked: one block can still move.
const boot = async ($: Engine, on: On, plan = WAITLIST_PLAN) => {
  const w = world(on, { [PLAN_FILE]: plan })
  w.cli = (args) => (args[0] === 'where' ? whereReply() : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return { w, clock }
}

test('every prompt carries the next-step rule when a plan exists, and the autopilot rules only while it is on', async ($, on) => {
  const { clock } = await boot($, on)
  const off = await $.prompt.compose(COMPOSE)
  expect(off.sections.map((s) => s.id)).toEqual(['intro', 'driver:next-step'])
  expect(off.sections[1]!.text).toContain("End every final reply with the user's next step")
  expect(off.sections[1]!.text).not.toContain('autopilot is ON')

  await $.command.run(typed('auto on', { kind: 'composer' }))
  await clock.advance(60)
  expect((await $.prompt.compose(COMPOSE)).sections[1]!.text).toContain('autopilot is ON')
})

test('without a plan the prompt is left alone', async ($, on) => {
  const w = world(on)
  w.cli = (args) => (args[0] === 'where' ? whereReply(false) : {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect((await $.prompt.compose(COMPOSE)).sections).toHaveLength(1)
})

test('only the person switches the autopilot on', async ($, on) => {
  const { w, clock } = await boot($, on)
  const r = await $.command.run(typed('auto on', { kind: 'plugin', name: 'someone' }))
  expect(r.text).toContain('switched by you')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(0)
})

test('switched on, it submits the next prompt after each turn and stops when the plan stops moving', async ($, on) => {
  const { w, clock } = await boot($, on)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toContain('Autopilot on')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toContain('DRIVER autopilot: continue the Implement phase without asking')

  // a subagent's turn ending is not the main loop's
  await $.turn.complete(ended('answer', 'a1'))
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)

  // the plan stays at the same revision: one more try, then it gives up
  await $.turn.complete(ended('answer'))
  await clock.advance(60)
  expect(w.prompts).toHaveLength(2)
  await $.turn.complete(ended('answer'))
  await clock.advance(60)
  expect(w.prompts).toHaveLength(2)
  expect(w.toasts.join('\n')).toContain('the plan did not change in 2 automatic turns')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'autopilot' }))?.text).toBe('Autopilot: off')
  await ui.unmount()
})

test('an interrupted turn switches it off', async ($, on) => {
  const { w, clock } = await boot($, on)
  await $.command.run(typed('auto on', { kind: 'composer' }))
  await clock.advance(60)
  await $.turn.complete(ended('aborted'))
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)
  expect(w.toasts.join('\n')).toContain('you interrupted the turn')
})

test('it does not start when nothing can move or the phase is not implement', async ($, on) => {
  const stuck = editPlan(WAITLIST_PLAN, (p) => {
    p.blocks['B-004'].status = 'blocked'
    p.blocks['B-004'].statusReason = 'waiting'
  })
  const { w, clock } = await boot($, on, stuck)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toContain('Autopilot stays off: no block can move')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(0)
})

test('the pane button switches it on and the Next line says so', async ($, on) => {
  const { w, clock } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'autopilot' })
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)
  expect((await ui.find({ key: 'autopilot' }))?.text).toBe('Autopilot: on')
  expect((await ui.find({ type: 'Text', text: /^Autopilot is on/ }))?.text).toContain('until both are done')
  await ui.unmount()
})

const looped = loopPlan(WAITLIST_PLAN)

test('in validate with work sent back, the autopilot goes and names the phase, rework and ready blocks', async ($, on) => {
  const { w, clock } = await boot($, on, looped)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toBe('Autopilot on: Claude keeps Implement and Validate going until both are done, a block needs you, or you switch it off.')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toBe(
    'DRIVER autopilot: continue the Validate phase without asking. Ready: B-009. Rework: B-004. Resumable: none. In progress: none. Follow the autopilot rules in your instructions.',
  )

  const rule = (await $.prompt.compose(COMPOSE)).sections[1]!.text
  expect(rule).toContain('autopilot is ON for the Implement and Validate phases')
  expect(rule).toContain('references/triage.md, section 4')
  expect(rule).toContain('Level 1')
  expect(rule).toContain('Level 2')
  expect(rule).toContain('decision.add titled "Autopilot: ..."')
  expect(rule).toContain('Never decide these: spending money, payment, health, identity-document or minors data, deleting data for good, legal commitments, pushing or publishing anything outside this machine, a missing credential.')
  expect(rule).toContain('Never approve a gate or confirm a baseline')
})

test('a validate block whose fix is done counts as workable and is listed as resumable', async ($, on) => {
  const resumed = editPlan(looped, (p) => {
    p.blocks['B-004'].status = 'done'
    p.blocks['B-009'].status = 'done'
  })
  const { w, clock } = await boot($, on, resumed)
  await $.command.run(typed('auto on', { kind: 'composer' }))
  await clock.advance(60)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toContain('Ready: none. Rework: none. Resumable: B-006.')
})

test('it stops when implement and validate are both done, and not before', async ($, on) => {
  const finished = editPlan(looped, (p) => {
    for (const id of ['B-004', 'B-006', 'B-009']) p.blocks[id].status = 'done'
  })
  const { w, clock } = await boot($, on, finished)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toBe('Autopilot stays off: every implement and validate block is done.')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(0)
})

test('with implement done and validate still ahead, it goes on and tells Claude to advance to validate', async ($, on) => {
  const implementDone = editPlan(WAITLIST_PLAN, (p) => {
    for (const id of ['B-004', 'B-005']) p.blocks[id].status = 'done'
  })
  const { w, clock } = await boot($, on, implementDone)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toBe('Autopilot on: Claude keeps Implement and Validate going until both are done, a block needs you, or you switch it off.')
  await clock.advance(60)
  expect(w.prompts).toEqual([
    'DRIVER autopilot: Implement is complete. Advance to validate with the phase.advance op (mcp__driver__plan_ops) and continue the Validate phase without asking. Follow the autopilot rules in your instructions.',
  ])
})

test('a blocked block whose reason only mentions another block is not workable', async ($, on) => {
  const held = editPlan(WAITLIST_PLAN, (p) => {
    for (const id of ['B-004', 'B-005']) p.blocks[id].status = 'done'
    p.currentPhase = 'validate'
    p.blocks['B-006'].status = 'blocked'
    p.blocks['B-006'].statusReason = 'missing STRIPE_KEY (needed by B-005 checkout)'
  })
  const { w, clock } = await boot($, on, held)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toBe('Autopilot stays off: no block can move: B-006 needs you.')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(0)
})

test('it does not start in evolve', async ($, on) => {
  const evolve = editPlan(looped, (p) => {
    p.currentPhase = 'evolve'
    for (const id of ['B-004', 'B-006', 'B-009']) p.blocks[id].status = 'done'
  })
  const { w, clock } = await boot($, on, evolve)
  const r = await $.command.run(typed('auto on', { kind: 'composer' }))
  expect(r.text).toBe('Autopilot stays off: the plan is in evolve, not implement or validate.')
  await clock.advance(60)
  expect(w.prompts).toHaveLength(0)
})

test('the autopilot button shows in implement and validate and not in evolve', async ($, on) => {
  await boot($, on, looped)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'autopilot' }))?.text).toBe('Autopilot: off')
  await ui.unmount()
})

test('the autopilot button is absent in evolve', async ($, on) => {
  const evolve = editPlan(looped, (p) => {
    p.currentPhase = 'evolve'
    for (const id of ['B-004', 'B-006', 'B-009']) p.blocks[id].status = 'done'
  })
  await boot($, on, evolve)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'autopilot' })).toBeUndefined()
  await ui.unmount()
})
