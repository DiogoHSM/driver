import { comparePhase, type Actor, type BlockStatus, type PlanV1 } from './schema.js';

export type ActorKind = Actor['kind'];
export type TransitionRequirement = 'deps_done' | 'artifacts' | 'reason' | 'verified';

export interface Transition {
  from: BlockStatus | '*';
  to: BlockStatus;
  who: readonly ActorKind[];
  requires: readonly TransitionRequirement[];
}

export const TRANSITIONS: readonly Transition[] = [
  { from: 'not_started', to: 'in_progress', who: ['model', 'user'], requires: ['deps_done'] },
  { from: 'in_progress', to: 'in_review', who: ['model', 'user'], requires: ['artifacts'] },
  { from: 'in_progress', to: 'blocked', who: ['model', 'hook', 'user'], requires: ['reason'] },
  { from: 'blocked', to: 'in_progress', who: ['model', 'user'], requires: [] },
  { from: 'in_review', to: 'done', who: ['model', 'user'], requires: ['verified'] },
  { from: 'in_review', to: 'needs_rework', who: ['model', 'user'], requires: ['reason'] },
  { from: 'done', to: 'needs_rework', who: ['model', 'user'], requires: ['reason'] },
  { from: 'needs_rework', to: 'in_progress', who: ['model', 'user'], requires: [] },
  { from: '*', to: 'not_started', who: ['user'], requires: [] },
];

export interface TransitionContext {
  actor: Actor;
  force?: boolean;
  reason?: string;
  /** Set only by the rebaseline op; the sole path to not_started. */
  rebaseline?: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

const no = (reason: string): TransitionCheck => ({ ok: false, reason });
const OK: TransitionCheck = { ok: true };

export function canTransition(
  plan: PlanV1,
  blockId: string,
  to: BlockStatus,
  ctx: TransitionContext,
): TransitionCheck {
  const b = plan.blocks[blockId];
  if (!b) return no(`unknown block ${blockId}`);
  if (b.retired) return no(`${blockId} is retired and cannot change status`);
  if (b.status === to) return no(`${blockId} is already ${to}`);

  if (to === 'not_started') {
    return ctx.actor.kind === 'user' && ctx.rebaseline
      ? OK
      : no('moving to not_started is only possible through rebaseline, by the user');
  }

  const t = TRANSITIONS.find((x) => x.from === b.status && x.to === to);
  if (!t) return no(`illegal transition ${b.status} -> ${to}`);
  if (!t.who.includes(ctx.actor.kind))
    return no(`actor kind ${ctx.actor.kind} cannot move ${b.status} -> ${to}`);
  if (ctx.force && ctx.actor.kind !== 'user') return no('force is only allowed for the user');

  if (to === 'in_progress' && comparePhase(b.phase, plan.currentPhase) > 0)
    return no(`${blockId} is in phase ${b.phase}, but currentPhase is ${plan.currentPhase}`);

  for (const req of t.requires) {
    if (req === 'deps_done') {
      if (!ctx.force) {
        const pending = b.dependsOn.filter((d) => {
          const dep = plan.blocks[d];
          return dep !== undefined && !dep.retired && dep.status !== 'done';
        });
        if (pending.length > 0) return no(`dependencies not done: ${pending.join(', ')}`);
      }
    } else if (req === 'artifacts') {
      if (b.artifacts.length === 0) return no('in_review requires at least one artifact');
    } else if (req === 'reason') {
      if (!ctx.reason?.trim()) return no(`${to} requires a reason`);
    } else if (req === 'verified') {
      if (b.verification?.passes !== true) return no('done requires verification.passes === true');
      const failing = b.tests.filter((x) => x.result === 'fail').map((x) => x.ref);
      if (failing.length > 0) return no(`failing tests: ${failing.join(', ')}`);
    }
  }
  return OK;
}

export type GateName = 'route' | 'release';
export interface GateRevocation {
  gate: GateName;
  reason: string;
}

/** ADR-010 item 4. Only gates that are approved after the op can be revoked. */
export function gateRevocations(before: PlanV1, after: PlanV1): GateRevocation[] {
  const out: GateRevocation[] = [];

  if (after.gates.release.approved) {
    const left = Object.keys(before.blocks).filter(
      (id) => before.blocks[id]!.status === 'done' && after.blocks[id]?.status !== 'done',
    );
    const reqChanged =
      after.baseline >= 1 &&
      (Object.keys(after.requirements).some((id) => !(id in before.requirements)) ||
        Object.keys(after.requirements).some(
          (id) => after.requirements[id]!.retired && !before.requirements[id]?.retired,
        ));
    if (after.baseline > before.baseline) {
      out.push({ gate: 'release', reason: `baseline moved to ${after.baseline}` });
    } else if (left.length > 0) {
      out.push({ gate: 'release', reason: `${left.join(', ')} left done` });
    } else if (reqChanged) {
      out.push({ gate: 'release', reason: 'requirements changed' });
    } else if (
      (before.currentPhase === 'evolve' || before.currentPhase === 'release') &&
      comparePhase(after.currentPhase, before.currentPhase) < 0
    ) {
      out.push({ gate: 'release', reason: `phase moved back from ${before.currentPhase}` });
    }
  }

  if (after.gates.route.approved && after.currentPhase === 'discover' && before.currentPhase !== 'discover')
    out.push({ gate: 'route', reason: 'phase moved back to discover' });
  return out;
}
