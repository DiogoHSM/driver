import { atom, read, update } from 'claude-code'
import type { Timer } from 'claude-code'

import type { PlanDoc } from '../src/shared/plan-doc.js'
import { project, shapeCheck } from '../src/shared/view.js'
import type {
  DriverClaim,
  DriverConfirm,
  DriverDetail,
  DriverIssue,
  DriverLoad,
  DriverPaths,
  DriverUi,
  DriverView,
} from '../types'
import { runCli, type Dollar } from './cli.js'
import { wasIssued } from './tickets.js'

export const PANE_ID = 'driver'

export const DEFAULT_UI: DriverUi = {
  focus: 'auto',
  collapseDone: false,
  showRetired: false,
  selected: null,
  confirm: null,
  initName: '',
  exportPath: null,
  notice: null,
  autopilot: false,
}

const pathsAtom = atom({ plugin: 'driver', key: 'paths' } as const, null)
const loadAtom = atom({ plugin: 'driver', key: 'load' } as const, { kind: 'none' })
const viewAtom = atom({ plugin: 'driver', key: 'view' } as const, null)
const uiAtom = atom({ plugin: 'driver', key: 'ui' } as const, DEFAULT_UI)
const detailAtom = atom({ plugin: 'driver', key: 'detail' } as const, null)
const claimsAtom = atom({ plugin: 'driver', key: 'claims' } as const, {})
const alertsAtom = atom({ plugin: 'driver', key: 'alerts' } as const, [])

// The scan only follows atoms written in the file that reads them, so every read and write lives here.
export function getView($: Dollar) {
  return read($, viewAtom)
}
export function getLoad($: Dollar) {
  return read($, loadAtom)
}
export function getUi($: Dollar) {
  return read($, uiAtom)
}
export function getDetail($: Dollar) {
  return read($, detailAtom)
}
export function getClaims($: Dollar) {
  return read($, claimsAtom)
}
export function getAlerts($: Dollar) {
  return read($, alertsAtom)
}
export function getStoredPaths($: Dollar) {
  return read($, pathsAtom)
}
export function clearDetail($: Dollar) {
  return update($, detailAtom, () => null)
}
export function updateClaims($: Dollar, change: (c: Record<string, DriverClaim>) => Record<string, DriverClaim>) {
  return update($, claimsAtom, change)
}

export async function setUi($: Dollar, patch: Partial<DriverUi>): Promise<void> {
  await update($, uiAtom, (u) => ({ ...u, ...patch }))
}

export async function setNotice($: Dollar, notice: string | null): Promise<void> {
  await setUi($, { notice })
}

/** Writes only when the value changed, so a redraw is not provoked for nothing. */
async function setIfChanged<T>(current: T, next: T, write: () => Promise<unknown>): Promise<void> {
  if (JSON.stringify(current) !== JSON.stringify(next)) await write()
}

// ---------------------------------------------------------------- paths

async function fallbackPaths($: Dollar): Promise<DriverPaths> {
  const root = (await $.session.root()).replace(/\/+$/, '')
  const driverDir = `${root}/.claude/driver`
  return { root, driverDir, planExists: await $.fs.exists(`${driverDir}/plan.json`) }
}

// Where the session was when the paths were resolved. The Desktop app can start a session in a
// spare directory and move it to the real project afterwards; paths resolved before the move
// point at the spare, so they are resolved again whenever the session's place changes.
let anchor: string | undefined

async function sessionPlace($: Dollar): Promise<string | undefined> {
  try {
    const [root, cwd] = await Promise.all([$.session.root(), $.session.cwd()])
    return `${root}\n${cwd}`
  } catch {
    return undefined
  }
}

/** Paths from state; without them, derived from the session root (no process is spawned). */
export async function getPaths($: Dollar): Promise<DriverPaths | null> {
  const known = await read($, pathsAtom)
  if (known) {
    const place = await sessionPlace($)
    if (place === undefined || anchor === undefined || place === anchor) {
      if (anchor === undefined) anchor = place
      return known
    }
    lastSig = ''
    return refreshPaths($)
  }
  try {
    const p = await fallbackPaths($)
    anchor = await sessionPlace($)
    await update($, pathsAtom, () => p)
    return p
  } catch {
    return null
  }
}

/** Asks the CLI where the project is (`where --json`); falls back to the session root. */
export async function refreshPaths($: Dollar): Promise<DriverPaths | null> {
  anchor = await sessionPlace($)
  const r = await runCli($, ['where'], { noRoot: true })
  const j = r.json as Partial<DriverPaths> | undefined
  if (r.ok && j && typeof j.root === 'string' && typeof j.driverDir === 'string') {
    const p: DriverPaths = { root: j.root, driverDir: j.driverDir, planExists: j.planExists === true }
    await update($, pathsAtom, () => p)
    return p
  }
  const p = await fallbackPaths($).catch(() => null)
  await update($, pathsAtom, () => p)
  if (!p) await update($, loadAtom, (): DriverLoad => ({ kind: 'error', message: r.error || 'DRIVER CLI unavailable' }))
  return p
}

// ---------------------------------------------------------------- plan reads

export type PlanRead =
  | { kind: 'ok'; plan: PlanDoc }
  | { kind: 'missing' }
  | { kind: 'bad'; message: string }

/** A fresh read and structural check of plan.json; hooks and tools never use the cached view. */
export async function readPlanFresh($: Dollar, driverDir: string): Promise<PlanRead> {
  const file = `${driverDir}/plan.json`
  let text: string
  try {
    text = (await $.fs.read(file)) as string
  } catch (e) {
    const exists = await $.fs.exists(file).catch(() => true)
    return exists ? { kind: 'bad', message: `plan.json is unreadable: ${(e as Error).message}` } : { kind: 'missing' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { kind: 'bad', message: `plan.json is not valid JSON: ${(e as Error).message}` }
  }
  const shaped = shapeCheck(raw)
  return shaped.ok ? { kind: 'ok', plan: shaped.plan } : { kind: 'bad', message: shaped.message }
}

const DOC_LIMIT = 6000

export async function loadDetail($: Dollar, id: string, revision: number): Promise<void> {
  const paths = await getPaths($)
  if (!paths) return
  let doc = ''
  try {
    doc = (await $.fs.read(`${paths.driverDir}/blocks/${id}.md`)) as string
  } catch {
    doc = '_No block document._'
  }
  const isTruncated = doc.length > DOC_LIMIT
  const detail: DriverDetail = { id, revision, doc: isTruncated ? doc.slice(0, DOC_LIMIT) : doc, isTruncated }
  await update($, detailAtom, () => detail)
}

// ---------------------------------------------------------------- poller

let lastSig = ''
let timer: Timer | undefined
let timerMs = 0
// undefined until the first look; false once a look found no plan. A plan that shows up after
// that (init, or the session moving into a project that has one) opens the pane once, if asked.
let sawPlan: boolean | undefined
let opensOnAppear = false

export function setOpensOnAppear(value: boolean): void {
  opensOnAppear = value
}

async function invalidIssues($: Dollar, message: string): Promise<DriverIssue[]> {
  const r = await runCli($, ['validate'])
  const j = r.json as { issues?: DriverIssue[] } | undefined
  if (j && Array.isArray(j.issues) && j.issues.length > 0) return j.issues.slice(0, 50)
  return [{ level: 'error', code: 'shape', path: 'plan.json', message }]
}

// Every approval records how it arrived (approvedVia). Compared poll to poll, an approval this
// session did not issue shows up: a typed one as an info toast, anything else as an alarm.
// Tamper evidence, not proof: whoever can write plan.json can also write approvedVia.
type Seen = { approved: boolean; at?: string; ticket?: string }
let prev: Record<string, Seen> | undefined
const flagged = new Map<string, string>()
const warned = new Set<string>()

async function checkApprovals($: Dollar, view: DriverView): Promise<void> {
  const isFirst = prev === undefined
  const next: Record<string, Seen> = {}
  const toasts: string[] = []
  for (const gate of ['route', 'release'] as const) {
    const g = view.gates[gate]
    next[gate] = { approved: g.approved, ...(g.at ? { at: g.at } : {}), ...(g.ticket ? { ticket: g.ticket } : {}) }
    if (!g.approved) {
      flagged.delete(gate)
      continue
    }
    const was = prev?.[gate]
    if (!isFirst && was?.approved && was.at === g.at && was.ticket === g.ticket) continue
    const alarm = `DRIVER: gate ${gate} approval not issued by this session (via: ${g.via ?? 'none'})`
    if (isFirst) {
      // an approval already there when the session looks is trusted, unless it says nothing about how it came
      if (!g.via) flagged.set(gate, alarm)
    } else if (g.via === 'tty') {
      flagged.delete(gate)
      toasts.push(`DRIVER: gate ${gate} approved in a terminal by ${g.by ?? 'someone'}`)
    } else if (g.via === 'mod' && g.ticket && (await wasIssued($, g.ticket))) {
      flagged.delete(gate)
    } else {
      flagged.set(gate, alarm)
    }
  }
  prev = next
  const alerts = [...flagged.values()]
  const cur = await read($, alertsAtom)
  if (JSON.stringify(cur) !== JSON.stringify(alerts)) await update($, alertsAtom, () => alerts)
  for (const text of toasts) $.ui.toast(text)
  for (const text of alerts) {
    if (warned.has(text)) continue
    warned.add(text)
    $.ui.toast(text)
    try {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `${text}. Tell the user: the plan shows an approval that this session's DRIVER mod never issued.` }] } })
    } catch {
      // the toast and the pane banner already say it
    }
  }
}

async function applyPlan($: Dollar, plan: PlanDoc): Promise<void> {
  const view: DriverView = project(plan)
  await checkApprovals($, view)
  const [curView, curLoad, curDetail, ui] = await Promise.all([
    read($, viewAtom),
    read($, loadAtom),
    read($, detailAtom),
    read($, uiAtom),
  ])
  const load: DriverLoad = { kind: 'ok', rev: view.revision }
  await setIfChanged(curView, view, () => update($, viewAtom, () => view))
  await setIfChanged(curLoad, load, () => update($, loadAtom, () => load))
  if (ui.selected && (!curDetail || curDetail.revision !== view.revision)) {
    if (view.blocks.some((b) => b.id === ui.selected)) await loadDetail($, ui.selected, view.revision)
    else await setUi($, { selected: null }).then(() => update($, detailAtom, () => null))
  }
}

/** Stats plan.json and, only when (mtime, size) moved, reads and projects it. */
export async function tick($: Dollar, force = false): Promise<void> {
  const paths = await getPaths($)
  if (!paths) return
  const file = `${paths.driverDir}/plan.json`
  let sig: string
  try {
    const st = await $.fs.stat(file)
    sig = `${st.mtimeMs}:${st.size}`
  } catch {
    lastSig = ''
    const curLoad = await read($, loadAtom)
    if (curLoad.kind !== 'none') {
      await update($, loadAtom, (): DriverLoad => ({ kind: 'none' }))
      await update($, viewAtom, () => null)
      await update($, detailAtom, () => null)
    }
    if (paths.planExists) await update($, pathsAtom, (p) => (p ? { ...p, planExists: false } : p))
    sawPlan = false
    return
  }
  if (!paths.planExists) await update($, pathsAtom, (p) => (p ? { ...p, planExists: true } : p))
  const isNew = sawPlan === false
  sawPlan = true
  if (isNew && opensOnAppear) void $.ui.open({ id: PANE_ID, title: 'DRIVER', columns: 72, closeOnEscape: true }).catch(() => undefined)
  if (!force && sig === lastSig) return
  lastSig = sig

  const planRead = await readPlanFresh($, paths.driverDir)
  if (planRead.kind === 'ok') return applyPlan($, planRead.plan)
  const message = planRead.kind === 'bad' ? planRead.message : 'plan.json disappeared'
  const view = await read($, viewAtom)
  const issues = await invalidIssues($, message)
  const load: DriverLoad = { kind: 'invalid', issues, lastGoodRev: view ? view.revision : null }
  await update($, loadAtom, () => load)
}

/** Forgets the stat signature and reads again; called after every write the mod makes. */
export async function forceTick($: Dollar): Promise<void> {
  lastSig = ''
  await tick($, true)
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p) => p.id === PANE_ID)
  } catch {
    return false
  }
}

function startTimer($: Dollar, ms: number): void {
  timer?.cancel()
  timerMs = ms
  timer = $.clock.every(ms, () => {
    void (async () => {
      try {
        await tick($)
        const want = (await isPaneOpen($)) ? 1000 : 5000
        if (want !== timerMs) startTimer($, want)
      } catch {
        // a failed tick is retried by the next one
      }
    })()
  })
}

/** A fresh module environment starts with no timer and no remembered signature. */
export function resetPoller(): void {
  timer = undefined
  timerMs = 0
  lastSig = ''
  anchor = undefined
  sawPlan = undefined
  opensOnAppear = false
  prev = undefined
  flagged.clear()
  warned.clear()
}

/** Idempotent. Timers die with a hot reload, so every entry point calls this again. */
export function ensurePoller($: Dollar): void {
  if (timer) return
  try {
    startTimer($, 1000)
  } catch {
    timer = undefined
  }
}

export type { DriverClaim, DriverConfirm }
