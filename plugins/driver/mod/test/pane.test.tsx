import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE, PLAN_FILE, ROOT, DRIVER_DIR, bigPlan, editPlan, whereReply, world } from './harness.js'
import { WAITLIST_B004_DOC, WAITLIST_PLAN } from './waitlist.js'

const DOC_FILE = `${DRIVER_DIR}/blocks/B-004.md`
const waitlist = { [PLAN_FILE]: WAITLIST_PLAN, [DOC_FILE]: WAITLIST_B004_DOC }

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const boot = async ($: Engine, on: On, files: Record<string, string>, cli?: (args: string[]) => object) => {
  const w = world(on, files)
  w.cli = (args) => (args[0] === 'where' ? whereReply() : (cli?.(args) ?? {}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return w
}

test('the terminal draws header, controls, phases, gates and rows as text', async ($, on) => {
  await boot($, on, waitlist)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^DRIVER · web-waitlist/ }))?.text).toBe('DRIVER · web-waitlist · phase implement · rev 34 · baseline 1')
  expect((await ui.find({ type: 'Text', text: /gate route: / }))?.text).toBe('gate route: ✓ approved by diogo   gate release: pending')
  expect((await ui.find({ type: 'Text', text: /IMPLEMENT/ }))?.text).toBe('▾ IMPLEMENT  1/3 done  ● current')
  expect(await ui.find({ type: 'Text', text: /── gate route ✓ diogo ──/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /── gate release · pending ──/ })).toBeDefined()
  expect(await ui.find({ key: 'phase-implement' })).toBeUndefined()
  expect((await ui.find({ key: 'done' }))?.text).toBe('Hide done')
  expect((await ui.find({ key: 'retired' }))?.text).toBe('Show retired')
  expect((await ui.find({ key: 'export' }))?.text).toBe('Export Mermaid')
  expect((await ui.find({ key: 'action' }))?.text).toBe('Advance to validate')
  expect(await ui.find({ key: 'focus', type: 'Select' })).toBeDefined()
  await ui.press({ key: 'B-004' })
  expect((await ui.find({ key: 'detail-doc' }))?.text).toContain('Signup API')
  await ui.press({ key: 'close-detail' })
  expect(await ui.find({ key: 'detail-doc' })).toBeUndefined()
  await ui.unmount()
})

const svgOf = async (ui: { find: (q: { type: 'Svg' }) => Promise<{ props?: unknown } | undefined> }) => {
  const node = await ui.find({ type: 'Svg' })
  return { node, source: String((node?.props as { source?: string } | undefined)?.source ?? '') }
}

test('desktop and vscode draw the SVG diagram with a block picker', async ($, on) => {
  await boot($, on, waitlist)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const { node, source } = await svgOf(ui)
    expect(node).toBeDefined()
    const props = node!.props as { alt: string; isInteractive: boolean; width: number; height: number }
    expect(props.alt.startsWith('DRIVER plan web-waitlist')).toBe(true)
    expect(props.isInteractive).toBe(true)
    expect(props.width).toBe(100 * 8 - 8)
    expect(Number.isInteger(props.height) && props.height > 0).toBe(true)
    for (const piece of ['<title>B-004 Signup API', 'IMPLEMENT', 'gate route · diogo', 'gate release · pending', 'font:13px']) expect(source).toContain(piece)
    // no card buttons any more
    expect(await ui.find({ key: 'B-004', type: 'Button' })).toBeUndefined()
    expect((await ui.find({ key: 'done' }))?.text).toBe('Done ✓')
    expect((await ui.find({ key: 'export' }))?.text).toBe('Export Mermaid')

    // the picker lists the drawn blocks; choosing one opens its detail and selects its card
    const picker = await ui.find({ key: 'block', type: 'Select' })
    expect(picker).toBeDefined()
    const options = (picker!.props as { options: { value: string; label: string }[] }).options
    expect(options.map((o) => o.value)).toContain('B-004')
    expect(options.find((o) => o.value === 'B-004')?.label).toBe('B-004 · Signup API')
    expect(await ui.find({ key: 'detail-doc' })).toBeUndefined()
    await ui.select({ key: 'block', value: 'B-004' })
    const doc = (await ui.find({ key: 'detail-doc' }))?.text ?? ''
    expect(doc).toContain('Delivered')
    expect(doc).not.toContain('id: B-004')
    expect((await ui.find({ type: 'Text', text: /in review since/ }))?.text).toContain('depends on B-003')
    expect((await svgOf(ui)).source).toContain('class="n s-in_review sel"')
    await ui.press({ key: 'close-detail' })
    expect(await ui.find({ key: 'detail-doc' })).toBeUndefined()
    await ui.unmount()
  }
})

test('mobile and desktop keep the same header and detail', async ($, on) => {
  await boot($, on, waitlist)

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^web-waitlist$/ }))?.text).toBe('web-waitlist')
    expect(await ui.find({ type: 'Text', text: /^phase implement · rev 34 · baseline 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^gate route ✓ diogo$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('mobile draws the card board', async ($, on) => {
  await boot($, on, waitlist)

  for (const surface of ['mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    // header: name and state on the left, the gates as pills on the right
    expect((await ui.find({ type: 'Text', text: /^web-waitlist$/ }))?.text).toBe('web-waitlist')
    expect(await ui.find({ type: 'Text', text: /^phase implement · rev 34 · baseline 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^gate route ✓ diogo$/ })).toBeDefined()
    // phases and gates
    expect(await ui.find({ type: 'Text', text: /^▾ IMPLEMENT$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+1\/3 done$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ gate route · approved by diogo$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^gate release · pending$/ })).toBeDefined()
    // cards: id and the status in words
    const card = await ui.find({ key: 'B-004' })
    expect(card?.text).toContain('B-004')
    expect(card?.text).toContain('in review')
    expect(card?.text).toContain('Signup API')
    expect((await ui.find({ key: 'B-005' }))?.text).toContain('blocked')
    // toolbar
    expect((await ui.find({ key: 'done' }))?.text).toBe('Done ✓')
    expect((await ui.find({ key: 'retired' }))?.text).toBe('Retired')
    expect((await ui.find({ key: 'export' }))?.text).toBe('Export Mermaid')
    expect((await ui.find({ key: 'action' }))?.text).toBe('Advance to validate')
    expect(await ui.find({ type: 'Select' })).toBeUndefined()

    // detail: no raw front matter, no empty headings, a close button
    await ui.press({ key: 'B-004' })
    const doc = (await ui.find({ key: 'detail-doc' }))?.text ?? ''
    expect(doc).toContain('Delivered')
    expect(doc).not.toContain('id: B-004')
    expect(doc).not.toContain('Acceptance criteria')
    expect((await ui.find({ type: 'Text', text: /in review since/ }))?.text).toContain('depends on B-003')
    await ui.press({ key: 'close-detail' })
    expect(await ui.find({ key: 'detail-doc' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a block with no notes says so', async ($, on) => {
  await boot($, on, { [PLAN_FILE]: WAITLIST_PLAN, [DOC_FILE]: '---\nid: B-004\ntitle: "Signup API"\n---\n\n# B-004 Signup API\n\n## Spec\n\n## Notes\n' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'block', value: 'B-004' })
  expect(await ui.find({ type: 'Text', text: /^no notes yet$/ })).toBeDefined()
  await ui.unmount()
})

test('the toolbar and the phase headers change what the board shows', async ($, on) => {
  await boot($, on, waitlist)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const optionIds = async () =>
    ((await ui.find({ key: 'block', type: 'Select' }))?.props as { options: { value: string }[] } | undefined)?.options.map((o) => o.value) ?? []
  expect((await svgOf(ui)).source).not.toContain('<title>B-001') // discover is two phases away: folded to its header
  expect(await optionIds()).not.toContain('B-001')
  await ui.select({ key: 'focus', value: 'discover' })
  expect((await svgOf(ui)).source).toContain('<title>B-001')
  expect(await optionIds()).toContain('B-001')
  await ui.select({ key: 'focus', value: 'all' })
  expect((await svgOf(ui)).source).toContain('<title>B-008')
  await ui.select({ key: 'focus', value: 'auto' })
  expect((await svgOf(ui)).source).not.toContain('<title>B-001')
  expect(await optionIds()).toContain('B-003')
  await ui.press({ key: 'done' })
  expect((await ui.find({ key: 'done' }))?.text).toBe('Done ○')
  expect(await optionIds()).not.toContain('B-003')
  expect((await svgOf(ui)).source).not.toContain('<title>B-003')
  expect((await svgOf(ui)).source).toContain('✓ 1 done')
  await ui.press({ key: 'done' })
  expect(await optionIds()).toContain('B-003')
  expect((await svgOf(ui)).source).toContain('<title>B-003')
  await ui.unmount()

  // mobile has no Select: a button cycles the focus
  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect((await mobile.find({ key: 'focus' }))?.text).toBe('Focus: current phase (auto)')
  await mobile.press({ key: 'focus' })
  expect((await mobile.find({ key: 'focus' }))?.text).toBe('Focus: all phases')
  await mobile.unmount()
})

const discoverPlan = editPlan(WAITLIST_PLAN, (p) => {
  p.currentPhase = 'discover'
  p.gates.route = { approved: false }
})
const evolvePlan = editPlan(WAITLIST_PLAN, (p) => {
  p.currentPhase = 'evolve'
  p.gates.release = { approved: false }
})
const releasePlan = editPlan(WAITLIST_PLAN, (p) => {
  p.currentPhase = 'release'
  p.gates.release = { approved: true, approvedBy: 'diogo', approvedAt: '2026-10-28T10:00:00Z', approvedVia: 'tty', atBaseline: 1 }
})

const primaryLabel = async ($: Engine, on: On, plan: string) => {
  await boot($, on, { [PLAN_FILE]: plan })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = (await ui.find({ key: 'action' }))?.text
  await ui.unmount()
  return text
}

test('the contextual action in discover is approving gate route', async ($, on) => {
  expect(await primaryLabel($, on, discoverPlan)).toBe('Approve gate route')
})
test('the contextual action advances when the next phase is open', async ($, on) => {
  expect(await primaryLabel($, on, WAITLIST_PLAN)).toBe('Advance to validate')
})
test('the contextual action in evolve is approving gate release', async ($, on) => {
  expect(await primaryLabel($, on, evolvePlan)).toBe('Approve gate release')
})
test('there is no contextual action after the last phase', async ($, on) => {
  expect(await primaryLabel($, on, releasePlan)).toBeUndefined()
})

test('Advance runs phase advance through the CLI as the model, and refusals are shown', async ($, on) => {
  let refuse = true
  const w = await boot($, on, waitlist, (args) =>
    args[0] === 'phase' ? (refuse ? { exitCode: 1, stderr: 'DRIVER: phase validate needs B-004 done' } : { stdout: JSON.stringify({ ok: true, revision: 35 }) }) : {},
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action' })
  expect(w.cliRuns().find((r) => r.args[0] === 'phase')?.args).toEqual(expect.arrayContaining(['phase', 'advance']))
  expect(w.cliRuns().find((r) => r.args[0] === 'phase')?.args.join(' ')).not.toContain('user:')
  expect((await ui.find({ type: 'Text', text: /needs B-004 done/ }))?.text).toContain('phase validate')
  refuse = false
  await ui.press({ key: 'action' })
  expect(w.toasts.join('\n')).toContain('Advanced to validate.')
  await ui.unmount()
})

test('a 200-block plan draws as rows, folding done blocks', async ($, on) => {
  await boot($, on, { [PLAN_FILE]: bigPlan(200) })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const first = await svgOf(ui)
  expect(first.node).toBeDefined()
  // the budget folds the done blocks, so few blocks are drawn: the picker is still a Select
  expect(first.source).toContain('✓ ')
  expect(await ui.find({ key: 'block', type: 'Select' })).toBeDefined()
  expect(await ui.find({ key: 'block-goto' })).toBeUndefined()
  await ui.press({ key: 'done' })
  expect((await svgOf(ui)).node).toBeDefined()
  await ui.unmount()
})

test('past 64 drawn blocks the picker is a typed id that opens a block or says it is unknown', async ($, on) => {
  const open = editPlan(bigPlan(80), (p) => {
    for (const b of Object.values(p.blocks as Record<string, { status: string; statusReason?: string }>)) {
      b.status = 'not_started'
      delete b.statusReason
    }
  })
  await boot($, on, { [PLAN_FILE]: open, [`${DRIVER_DIR}/blocks/B-010.md`]: '---\nid: B-010\ntitle: "t"\n---\n\n# B-010 t\n\n## Handoff\nTen is here.\n' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await svgOf(ui)).node).toBeDefined()
  expect(await ui.find({ key: 'block', type: 'Select' })).toBeUndefined()
  expect(await ui.find({ key: 'block-goto', type: 'Input' })).toBeDefined()
  expect(await ui.find({ key: 'detail-doc' })).toBeUndefined()
  await ui.input({ key: 'block-goto', text: 'B-010', kind: 'submit' })
  expect((await ui.find({ key: 'detail-doc' }))?.text).toContain('Ten is here.')
  await ui.input({ key: 'block-goto', text: 'B-999', kind: 'submit' })
  expect((await ui.find({ type: 'Text', text: /^No block B-999 in this plan\.$/ }))?.text).toBe('No block B-999 in this plan.')
  await ui.unmount()
})

test('without a plan the pane offers Initialize, which runs driver init', async ($, on) => {
  const w = world(on)
  w.cli = (args) => (args[0] === 'where' ? whereReply(false) : { stdout: JSON.stringify({ ok: true, driverDir: DRIVER_DIR }) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /No DRIVER plan/ })).toBeDefined()
    await ui.input({ key: 'init-name', text: 'my-project', kind: 'change' })
    await ui.press({ key: 'init' })
    await ui.unmount()
  }
  const init = w.cliRuns().find((r) => r.args.includes('init'))
  expect(init?.args.slice(-2)).toEqual(['init', 'my-project'])
})

test('an invalid plan shows the validation issues', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: '{ "schemaVersion": 1, "oops": ' })
  w.cli = (args) => {
    if (args[0] === 'where') return whereReply()
    if (args[0] === 'validate')
      return { exitCode: 1, stdout: JSON.stringify({ ok: false, issues: [{ level: 'error', code: 'parse', path: 'plan.json', message: 'Unexpected end of JSON input' }] }) }
    return {}
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /The plan is invalid \(1 issue\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\[parse\] plan.json: Unexpected end/ })).toBeDefined()
    await ui.unmount()
  }
})

test('approving a gate takes two presses and sends the nonce on stdin only', async ($, on) => {
  const w = world(on, { [PLAN_FILE]: editPlan(WAITLIST_PLAN, (p) => { p.currentPhase = 'evolve' }) })
  w.cli = (args) => {
    if (args[0] === 'where') return whereReply()
    if (args[0] === 'gate') return { stdout: JSON.stringify({ ok: true, revision: 35 }) }
    return {}
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'action' })
  expect((await ui.find({ type: 'Text', text: /Approve gate release/ }))?.text).toBe('Approve gate release at revision 34 (baseline 1)?')
  expect(w.writes).toHaveLength(0)
  await ui.press({ key: 'confirm-no' })
  expect(await ui.find({ key: 'confirm-yes' })).toBeUndefined()

  await ui.press({ key: 'action' })
  await ui.press({ key: 'confirm-yes' })
  const ticket = w.writes.find((x) => x.path === `${DRIVER_DIR}/.mod/ticket.json`)
  expect(ticket).toBeDefined()
  const t = JSON.parse(ticket!.text) as { gate: string; revision: number; sha256: string; exp: number }
  expect(t).toMatchObject({ gate: 'release', revision: 34, exp: 1_015_000 })
  const call = w.cliRuns().find((r) => r.args.includes('gate'))
  const nonce = call?.stdin ?? ''
  expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
  expect(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(t.sha256)
  expect(call?.args).toContain('--via-mod')
  expect(call?.args.join(' ')).not.toContain(nonce)
  expect(ticket!.text).not.toContain(nonce)
  await ui.unmount()
})
