import type { On } from 'claude-code'

import type { PhaseId } from '../src/shared/phases.js'
import { summarize } from '../src/shared/view.js'
import type { DriverView } from '../types'
import type { Dollar } from './cli.js'
import { resumableIds } from './next.js'
import { ensurePoller, forceTick, getUi, getView, setUi } from './state.js'

// ADR-015, ADR-016: a standing "say the next step" rule in the system prompt, and an optional
// autopilot that keeps Implement and Validate going, and the loop between them, turn after turn
// until both are done or something needs the person.

const MAX_TURNS = 60
const MAX_STALLS = 2

const LOOP: readonly PhaseId[] = ['implement', 'validate']

/** The autopilot works in the two phases of the loop. */
export const isAutopilotPhase = (phase: PhaseId): boolean => LOOP.includes(phase)

const cap = (phase: PhaseId): string => phase.charAt(0).toUpperCase() + phase.slice(1)

let turns = 0
let stalls = 0
let lastRevision: number | undefined

/** A fresh module environment (hot reload) starts the counters over; the switch itself lives in $.state. */
export function resetAutopilot(): void {
  turns = 0
  stalls = 0
  lastRevision = undefined
}

export const NEXT_STEP_RULE = [
  'DRIVER (this project has a DRIVER plan). If you are the main session talking to the user:',
  "- End every final reply with the user's next step: a question with the options, or the exact thing to type or press. Never end on a bare status report.",
  '- After a side task (a commit, a question, a fix) come back to the plan: name the blocks that are ready, recommend one and say why.',
  '- When two or more independent blocks are ready, offer to run them in parallel.',
  '- When the user seems to want less back-and-forth during Implement or Validate, mention the Autopilot button in the DRIVER pane (or /driver auto on).',
].join('\n')

export const AUTOPILOT_RULE = [
  'DRIVER autopilot is ON for the Implement and Validate phases and the loop between them: the user asked you to keep going without questions.',
  '- Do not ask the user anything and do not use AskUserQuestion. Pick the workable block yourself (rework first, then ready ones by highest risk or critical path), build or validate it, record artifacts and tests, hand off and close it. Resume blocks that waited on a fix once it is done.',
  '- Triage anything that changes the plan after the route gate (references/triage.md, section 4). Level 1 (a failed acceptance criterion): move the block to needs_rework with the evidence, no new block. Level 2 (new work for an approved requirement): decision.add and a new block, one line to the user. Level 3 (scope change): take the recommended exit, preferring the next cycle (mcp__driver__backlog), and record it with decision.add titled "Autopilot: ...".',
  '- Decide what has a safe default; record each non-obvious choice with decision.add.',
  '- Never decide these: spending money, payment, health, identity-document or minors data, deleting data for good, legal commitments, pushing or publishing anything outside this machine, a missing credential. Mark that block blocked with the reason and move to another workable block.',
  '- Never approve a gate or confirm a baseline. Commit finished blocks locally if the project uses git; never push.',
  '- End each reply with one line: what you finished and what you will pick up next.',
].join('\n')

const phaseDone = (view: DriverView, phase: PhaseId): boolean =>
  view.blocks.filter((b) => !b.retired && b.phase === phase).every((b) => b.status === 'done')

/** Implement is finished and validate has work left: the next move is the phase change itself. */
const readyToValidate = (view: DriverView): boolean => view.currentPhase === 'implement' && phaseDone(view, 'implement')

/** What the autopilot does with the plan as it stands: go on, or stop and why. */
export function autopilotVerdict(view: DriverView | null): { go: true } | { go: false; why: string } {
  if (!view) return { go: false, why: 'there is no plan' }
  if (!isAutopilotPhase(view.currentPhase)) return { go: false, why: `the plan is in ${view.currentPhase}, not implement or validate` }
  if (LOOP.every((p) => phaseDone(view, p))) return { go: false, why: 'every implement and validate block is done' }
  const s = summarize(view)
  const resumable = resumableIds(view)
  const open = view.blocks.filter((b) => !b.retired && LOOP.includes(b.phase))
  const isWorkable = readyToValidate(view) || open.some(
    (b) => s.ready.includes(b.id) || resumable.includes(b.id) || b.status === 'in_progress' || b.status === 'in_review' || b.status === 'needs_rework',
  )
  if (!isWorkable) {
    return { go: false, why: `no block can move: ${s.blocked.map((b) => b.id).join(', ') || 'nothing is ready'} needs you` }
  }
  return { go: true }
}

function kickoffText(view: DriverView): string {
  const s = summarize(view)
  const list = (ids: string[]) => ids.join(', ') || 'none'
  if (readyToValidate(view))
    return 'DRIVER autopilot: Implement is complete. Advance to validate with the phase.advance op (mcp__driver__plan_ops) and continue the Validate phase without asking. Follow the autopilot rules in your instructions.'
  return `DRIVER autopilot: continue the ${cap(view.currentPhase)} phase without asking. Ready: ${list(s.ready)}. Rework: ${list(s.rework)}. Resumable: ${list(resumableIds(view))}. In progress: ${list(s.inProgress.map((b) => b.id))}. Follow the autopilot rules in your instructions.`
}

async function stop($: Dollar, why: string): Promise<void> {
  resetAutopilot()
  await setUi($, { autopilot: false, notice: `Autopilot off: ${why}.` })
  $.ui.toast(`DRIVER autopilot off: ${why}.`)
}

/** One step: stop with a reason, or submit the next prompt. Runs after a turn ends and when switched on. */
async function step($: Dollar): Promise<void> {
  await forceTick($).catch(() => undefined)
  const view = await getView($)
  const verdict = autopilotVerdict(view)
  if (!verdict.go || !view) return stop($, verdict.go ? 'there is no plan' : verdict.why)
  if (lastRevision !== undefined && view.revision === lastRevision) stalls++
  else stalls = 0
  if (stalls >= MAX_STALLS) return stop($, `the plan did not change in ${MAX_STALLS} automatic turns`)
  if (turns >= MAX_TURNS) return stop($, `${MAX_TURNS} automatic turns reached`)
  turns++
  lastRevision = view.revision
  void $.prompt.submit({ text: kickoffText(view) }).catch(() => undefined)
}

/** Later, so the turn or command that led here has finished and the session is idle. */
function stepSoon($: Dollar): void {
  try {
    $.clock.after(50, () => {
      void step($).catch(() => undefined)
    })
  } catch {
    // no timers: the pane still shows the switch and the next step
  }
}

/** Person-initiated only (a pane press or a typed command). */
export async function setAutopilot($: Dollar, isOn: boolean): Promise<string> {
  resetAutopilot()
  if (!isOn) {
    await setUi($, { autopilot: false, notice: null })
    return 'Autopilot off.'
  }
  const verdict = autopilotVerdict(await getView($))
  if (!verdict.go) return `Autopilot stays off: ${verdict.why}.`
  await setUi($, { autopilot: true, notice: null })
  stepSoon($)
  return 'Autopilot on: Claude keeps Implement and Validate going until both are done, a block needs you, or you switch it off.'
}

export function registerAutopilot(on: On): void {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId === undefined && (await getUi($)).autopilot) {
        ensurePoller($)
        if (e.reason === 'answer') stepSoon($)
        else await stop($, e.reason === 'aborted' ? 'you interrupted the turn' : `the turn ended with ${e.reason}`)
      }
    } catch {
      // the answer stands whatever happens here
    }
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const view = await getView($)
      if (!view) return composed
      const ui = await getUi($)
      const text = ui.autopilot && isAutopilotPhase(view.currentPhase) ? `${NEXT_STEP_RULE}\n\n${AUTOPILOT_RULE}` : NEXT_STEP_RULE
      return { ...composed, sections: [...composed.sections, { id: 'driver:next-step', text, scope: 'session' as const }] }
    } catch {
      return composed
    }
  })
}
