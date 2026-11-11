import { PHASES, type PhaseId } from '../src/shared/phases.js'
import type { DriverGateName, DriverView } from '../types'
import { runCli, type Dollar } from './cli.js'
import { forceTick } from './state.js'

// ADR-014: the pane always says what comes next, and its main button hands the work to Claude.

export type Primary = {
  label: string
  run: 'approve-route' | 'approve-release' | 'continue' | 'start'
  /** The phase the action leads to (or stays in, for continue). */
  phase: PhaseId
}

const SKILLS: Partial<Record<PhaseId, string>> = { discover: 'driver:discover', route: 'driver:route' }

function active(view: DriverView, phase: PhaseId) {
  return view.blocks.filter((b) => !b.retired && b.phase === phase)
}

/** A phase is complete when it has blocks and every active one is done. */
export function isPhaseComplete(view: DriverView, phase: PhaseId): boolean {
  const blocks = active(view, phase)
  return blocks.length > 0 && blocks.every((b) => b.status === 'done')
}

/** The one contextual action: approve a gate where the method asks for it, keep the current phase going, or start the next. */
export function primaryAction(view: DriverView): Primary | null {
  const cur = view.currentPhase
  if (cur === 'discover' && !view.gates.route.approved) return { label: 'Approve route gate', run: 'approve-route', phase: 'route' }
  if (cur === 'evolve' && !view.gates.release.approved) return { label: 'Approve release gate', run: 'approve-release', phase: 'release' }
  if (!isPhaseComplete(view, cur)) return { label: `Continue ${cur}`, run: 'continue', phase: cur }
  const next = PHASES[PHASES.indexOf(cur) + 1]
  if (!next) return null
  const guard = next === 'route' ? view.gates.route : next === 'release' ? view.gates.release : null
  if (guard && !guard.approved) return null
  return { label: `Start ${next}`, run: 'start', phase: next }
}

/** One line for the pane: what the person does now. */
export function nextStep(view: DriverView): string {
  const p = primaryAction(view)
  const cur = view.currentPhase
  if (!p) return cur === 'release' ? 'Next: nothing left, the release is done.' : `Next: ${cur} is complete.`
  if (p.run === 'approve-route' || p.run === 'approve-release')
    return `Next: review the plan, then "${p.label}". Approving starts ${p.phase} right away.`
  if (p.run === 'start') return `Next: ${cur} is complete. "${p.label}" hands ${p.phase} to Claude.`
  const blocks = active(view, cur)
  const left = blocks.filter((b) => b.status !== 'done').length
  return blocks.length === 0
    ? `Next: ${cur} has no blocks yet. "${p.label}" asks Claude to work on it.`
    : `Next: ${left} of ${blocks.length} ${cur} blocks left. "${p.label}" asks Claude to pick up the next one.`
}

/** The fixed text the mod submits as a prompt. It asks for work; it can approve nothing. */
export function kickoffText(phase: PhaseId, why: string): string {
  const skill = SKILLS[phase]
  const ask = skill
    ? `Run the ${skill} skill now.`
    : `There is no DRIVER skill for phase ${phase} yet: call mcp__driver__plan_status, list every ready block with your recommendation and the reason, offer to run independent ones in parallel when two or more are ready, and ask which to start.`
  return `DRIVER pane: the user ${why}. Phase ${phase}. ${ask} End your reply with the user's next step.`
}

/** Submits the kickoff as a turn of its own (queued when the session is busy). Never throws. */
export async function kickoff($: Dollar, phase: PhaseId, why: string): Promise<void> {
  try {
    void $.prompt.submit({ text: kickoffText(phase, why) }).catch(() => undefined)
  } catch {
    // headless or no prompt: the pane's Next line still says what to do
  }
}

/**
 * The same, a moment later: a prompt submitted from inside a command.run hook does not start a
 * turn, so the typed /driver approve lets the command finish first.
 */
function kickoffSoon($: Dollar, phase: PhaseId, why: string): void {
  try {
    $.clock.after(50, () => {
      void kickoff($, phase, why)
    })
  } catch {
    // no timers here: the pane's Next line still says what to do
  }
}

/** Moves to the next phase (when the plan is not there yet) and hands it to Claude. */
export async function advanceAndKickoff($: Dollar, to: PhaseId, current: PhaseId, why: string, isDeferred = false): Promise<{ ok: boolean; message: string }> {
  if (current !== to) {
    const r = await runCli($, ['phase', 'advance'])
    if (!r.ok) return { ok: false, message: r.error || 'DRIVER: could not advance the phase' }
    await forceTick($)
  }
  if (isDeferred) kickoffSoon($, to, why)
  else await kickoff($, to, why)
  return { ok: true, message: `Started ${to}. Claude takes it from here.` }
}

/** After a gate approval by the person: the phase the gate opens, started at once. */
export function afterApproval($: Dollar, gate: DriverGateName, current: PhaseId, isDeferred = false) {
  return advanceAndKickoff($, gate, current, `approved the ${gate} gate`, isDeferred)
}
