import { nextId, type IdKind } from './ids.js';
import {
  PHASES,
  phaseIndex,
  type Actor,
  type Block,
  type Decision,
  type BlockStatus,
  type PhaseId,
  type PlanV1,
  type Requirement,
  type TestRef,
} from './schema.js';
import { canTransition, gateRevocations, type GateName } from './state-machine.js';
import { hasErrors, validatePlan, type Issue } from './validate.js';

export type BlockPatch = Partial<
  Pick<Block, 'title' | 'dependsOn' | 'requirements' | 'provider' | 'artifacts' | 'tests' | 'risk' | 'verification'>
> & {
  /** Appended (deduplicated) so concurrent writers never clobber each other's artifacts. */
  addArtifacts?: string[];
  /** Upserted by `ref`; `at` is stamped when missing. */
  addTests?: TestRef[];
};

export type Op =
  | { type: 'req.add'; title: string; kind: Requirement['kind']; source: Requirement['source']; ref?: string }
  | { type: 'req.retire'; id: string; decision: string; reason: string }
  | {
      type: 'block.add';
      title: string;
      phase: PhaseId;
      dependsOn?: string[];
      requirements?: string[];
      provider?: Block['provider'];
      risk?: Block['risk'];
    }
  | { type: 'block.set'; id: string; patch: BlockPatch }
  | { type: 'block.status'; id: string; to: BlockStatus; reason?: string; force?: boolean; owner?: string }
  | { type: 'block.retire'; id: string; decision: string; reason: string }
  | { type: 'block.orphan'; owner: string }
  | { type: 'decision.add'; title: string; reason?: string }
  | { type: 'gate.approve'; gate: GateName; decision?: string }
  | { type: 'gate.revoke'; gate: GateName; reason: string }
  | { type: 'phase.advance' }
  | { type: 'phase.back'; to: PhaseId; reason: string }
  | { type: 'rebaseline'; decision?: string; reason: string; changed?: string[] }
  | { type: 'release.add'; version: string; commit: string; blocks: string[] }
  | { type: 'renumber' };

export type EventType =
  | 'block.status'
  | 'block.add'
  | 'block.set'
  | 'req.add'
  | 'gate.approve'
  | 'gate.revoke'
  | 'phase.change'
  | 'rebaseline'
  | 'release'
  | 'retire'
  | 'decision.add'
  | 'orphan';

export interface Event {
  seq?: number;
  revision?: number;
  ts: string;
  actor: Actor;
  type: EventType;
  block?: string;
  from?: string;
  to?: string;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface OpContext {
  actor: Actor;
  now: string;
}

export interface OpResult {
  plan: PlanV1;
  events: Event[];
  /** Id allocated by the op (R/B/D/REL), when there is one. */
  created?: string;
}

const PATCH_KEYS = new Set([
  'title', 'dependsOn', 'requirements', 'provider', 'artifacts', 'addArtifacts', 'tests', 'addTests', 'risk', 'verification',
]);

export class PlanInvariantError extends Error {
  constructor(
    readonly issues: Issue[],
    hint?: string,
  ) {
    super(
      `plan invariant violated: ${issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`).join('; ')}${hint ? ` (${hint})` : ''}`,
    );
    this.name = 'PlanInvariantError';
  }
}

/** The op is well-formed but not allowed in the current state or for this actor. */
export class OpRefusedError extends Error {
  constructor(
    message: string,
    readonly forbidden = false,
  ) {
    super(message);
    this.name = 'OpRefusedError';
  }
}

interface Draft {
  plan: PlanV1;
  ctx: OpContext;
  events: Event[];
  created?: string;
}

const refuse = (msg: string, forbidden = false): never => {
  throw new OpRefusedError(msg, forbidden);
};

function emit(d: Draft, e: Omit<Event, 'ts' | 'actor'>): void {
  d.events.push({ ts: d.ctx.now, actor: d.ctx.actor, ...e });
}

function alloc(d: Draft, kind: IdKind): string {
  const r = nextId(d.plan, kind);
  d.plan = r.plan;
  return r.id;
}

function getBlock(d: Draft, id: string): Block {
  const b = d.plan.blocks[id];
  if (!b) return refuse(`unknown block ${id}`);
  if (b.retired) return refuse(`${id} is retired`);
  return b;
}

function transition(
  d: Draft,
  id: string,
  to: BlockStatus,
  o: { reason?: string; force?: boolean; rebaseline?: boolean; owner?: string },
): void {
  const check = canTransition(d.plan, id, to, { actor: d.ctx.actor, ...o });
  if (!check.ok) refuse(check.reason);
  const b = d.plan.blocks[id]!;
  const from = b.status;
  b.status = to;
  b.statusSince = d.ctx.now;
  b.statusBy = d.ctx.actor;
  if (to === 'blocked' || to === 'needs_rework') b.statusReason = o.reason;
  else delete b.statusReason;
  if (to === 'in_progress') b.owner = o.owner ?? d.ctx.actor.id;
  else delete b.owner;
  // A stale passing verification must not let a reworked block skip review.
  if (to === 'needs_rework' || to === 'not_started') delete b.verification;
  emit(d, { type: 'block.status', block: id, from, to, ...(o.reason ? { reason: o.reason } : {}) });
}

const activeIds = <T extends { retired?: unknown }>(rec: Record<string, T>): string[] =>
  Object.keys(rec)
    .filter((id) => !rec[id]!.retired)
    .sort();

/** First use on a legacy plan backfills the decisions it already cites, so the registry is complete. */
function backfillDecisions(plan: PlanV1): Record<string, Decision> {
  const by: Actor = { kind: 'hook', id: 'backfill' };
  const out: Record<string, Decision> = {};
  const note = (id: string, at: string) => (out[id] ??= { title: 'Decision (backfilled)', at, by });
  for (const b of plan.baselines) note(b.decision, b.at);
  for (const x of [...Object.values(plan.blocks), ...Object.values(plan.requirements)])
    if (x.retired) note(x.retired.decision, x.retired.at);
  return out;
}

function registerDecision(d: Draft, id: string, title: string, reason?: string): void {
  d.plan.decisions = {
    ...(d.plan.decisions ?? backfillDecisions(d.plan)),
    [id]: { title, at: d.ctx.now, ...(reason ? { reason } : {}), by: d.ctx.actor },
  };
}

function setPhase(d: Draft, to: PhaseId, reason?: string): void {
  const from = d.plan.currentPhase;
  d.plan.currentPhase = to;
  emit(d, { type: 'phase.change', from, to, ...(reason ? { reason } : {}) });
}

function handle(d: Draft, op: Op): void {
  const { plan, ctx } = d;
  switch (op.type) {
    case 'req.add': {
      const id = alloc(d, 'R');
      d.plan.requirements[id] = {
        title: op.title,
        kind: op.kind,
        source: op.source,
        ...(op.ref ? { ref: op.ref } : {}),
      };
      d.created = id;
      emit(d, { type: 'req.add', data: { id, title: op.title } });
      return;
    }
    case 'req.retire': {
      const r = plan.requirements[op.id];
      if (!r) return refuse(`unknown requirement ${op.id}`);
      if (r.retired) return refuse(`${op.id} is already retired`);
      r.retired = { at: ctx.now, decision: op.decision, reason: op.reason };
      emit(d, { type: 'retire', reason: op.reason, data: { id: op.id, decision: op.decision } });
      return;
    }
    case 'block.add': {
      const id = alloc(d, 'B');
      d.plan.blocks[id] = {
        title: op.title,
        phase: op.phase,
        status: 'not_started',
        statusSince: ctx.now,
        statusBy: ctx.actor,
        dependsOn: [...(op.dependsOn ?? [])],
        requirements: [...(op.requirements ?? [])],
        ...(op.provider ? { provider: op.provider } : {}),
        artifacts: [],
        tests: [],
        ...(op.risk ? { risk: op.risk } : {}),
      };
      d.created = id;
      emit(d, { type: 'block.add', block: id, data: { title: op.title, phase: op.phase } });
      return;
    }
    case 'block.set': {
      const b = getBlock(d, op.id);
      const unknown = Object.keys(op.patch).filter((k) => !PATCH_KEYS.has(k));
      if (unknown.length > 0) return refuse(`block.set cannot change: ${unknown.join(', ')}`, true);
      const { addArtifacts, addTests, ...direct } = op.patch;
      const keys: string[] = [];
      for (const [k, v] of Object.entries(direct)) {
        if (v === undefined) continue;
        (b as Record<string, unknown>)[k] = v;
        keys.push(k);
      }
      if (addArtifacts?.length) {
        b.artifacts = [...new Set([...b.artifacts, ...addArtifacts])];
        keys.push('artifacts');
      }
      if (addTests?.length) {
        for (const t of addTests) {
          const next: TestRef = { ...t, at: t.at ?? ctx.now };
          const i = b.tests.findIndex((x) => x.ref === t.ref);
          if (i >= 0) b.tests[i] = next;
          else b.tests.push(next);
        }
        keys.push('tests');
      }
      emit(d, { type: 'block.set', block: op.id, data: { fields: [...new Set(keys)].sort() } });
      return;
    }
    case 'block.status':
      transition(d, op.id, op.to, { reason: op.reason, force: op.force, owner: op.owner });
      return;
    case 'block.retire': {
      const b = getBlock(d, op.id);
      if (b.status === 'in_progress') return refuse(`${op.id} is in_progress; block it before retiring`);
      b.retired = { at: ctx.now, decision: op.decision, reason: op.reason };
      emit(d, { type: 'retire', block: op.id, reason: op.reason, data: { decision: op.decision } });
      return;
    }
    case 'block.orphan': {
      const hit = Object.keys(plan.blocks)
        .sort()
        .filter((id) => {
          const b = plan.blocks[id]!;
          return !b.retired && b.status === 'in_progress' && b.owner === op.owner;
        });
      for (const id of hit)
        transition(d, id, 'blocked', { reason: 'agent ended without handoff' });
      if (hit.length > 0)
        emit(d, { type: 'orphan', data: { owner: op.owner, blocks: hit } });
      return;
    }
    case 'decision.add': {
      const id = alloc(d, 'D');
      registerDecision(d, id, op.title, op.reason);
      d.created = id;
      emit(d, { type: 'decision.add', data: { id, title: op.title } });
      return;
    }
    case 'gate.approve': {
      if (ctx.actor.kind !== 'user') return refuse('gate approval is user-only', true);
      if (plan.gates[op.gate].approved) return refuse(`gate ${op.gate} is already approved`);
      if (op.gate === 'release' && !plan.gates.route.approved)
        return refuse('gate release requires gate route to be approved first');
      let decision: string | undefined;
      if (op.gate === 'route' && plan.baseline === 0) {
        decision = op.decision ?? alloc(d, 'D');
        if (!op.decision) {
          d.created = decision;
          registerDecision(d, decision, 'Gate 1: route approved');
        }
        d.plan.baseline = 1;
        d.plan.baselines.push({
          n: 1,
          at: ctx.now,
          decision,
          reason: 'Gate 1: route approved',
          added: activeIds(d.plan.blocks),
          retired: [],
          changed: [],
          reqAdded: activeIds(d.plan.requirements),
          reqRetired: [],
        });
      }
      d.plan.gates[op.gate] = {
        approved: true,
        approvedAt: ctx.now,
        approvedBy: ctx.actor.id,
        atBaseline: d.plan.baseline,
      };
      emit(d, {
        type: 'gate.approve',
        data: { gate: op.gate, baseline: d.plan.baseline, ...(decision ? { decision } : {}) },
      });
      return;
    }
    case 'gate.revoke': {
      const g = plan.gates[op.gate];
      if (!g.approved) return refuse(`gate ${op.gate} is not approved`);
      revoke(d, op.gate, op.reason);
      return;
    }
    case 'phase.advance': {
      const i = phaseIndex(plan.currentPhase);
      const to = PHASES[i + 1];
      if (!to) return refuse('already at the last phase (release)');
      if (to === 'route' && !plan.gates.route.approved) return refuse('gate route is not approved');
      if (to === 'release' && !plan.gates.release.approved) return refuse('gate release is not approved');
      setPhase(d, to);
      return;
    }
    case 'phase.back': {
      if (phaseIndex(op.to) >= phaseIndex(plan.currentPhase))
        return refuse(`${op.to} is not before ${plan.currentPhase}`);
      if (!op.reason.trim()) return refuse('phase back requires a reason');
      setPhase(d, op.to, op.reason);
      return;
    }
    case 'rebaseline': {
      if (ctx.actor.kind !== 'user') return refuse('rebaseline is user-only', true);
      if (plan.baseline === 0) return refuse('no baseline yet: approve gate route first');
      const decision = op.decision ?? alloc(d, 'D');
      if (!op.decision) {
        d.created = decision;
        registerDecision(d, decision, `Rebaseline: ${op.reason}`, op.reason);
      }
      const changed = [...new Set(op.changed ?? [])].sort();
      for (const id of changed) getBlock(d, id);
      const seenBlocks = new Set(d.plan.baselines.flatMap((b) => b.added));
      const seenRetired = new Set(d.plan.baselines.flatMap((b) => b.retired));
      const seenReqs = new Set(d.plan.baselines.flatMap((b) => b.reqAdded));
      const seenReqRetired = new Set(d.plan.baselines.flatMap((b) => b.reqRetired));
      const retiredBlocks = Object.keys(d.plan.blocks).filter((id) => d.plan.blocks[id]!.retired);
      const retiredReqs = Object.keys(d.plan.requirements).filter((id) => d.plan.requirements[id]!.retired);
      const n = d.plan.baseline + 1;
      d.plan.baseline = n;
      d.plan.baselines.push({
        n,
        at: ctx.now,
        decision,
        reason: op.reason,
        added: activeIds(d.plan.blocks).filter((id) => !seenBlocks.has(id)),
        retired: retiredBlocks.filter((id) => !seenRetired.has(id)).sort(),
        changed,
        reqAdded: activeIds(d.plan.requirements).filter((id) => !seenReqs.has(id)),
        reqRetired: retiredReqs.filter((id) => !seenReqRetired.has(id)).sort(),
      });
      for (const id of changed)
        if (d.plan.blocks[id]!.status !== 'not_started')
          transition(d, id, 'not_started', { reason: `rebaseline ${decision}`, rebaseline: true });
      emit(d, { type: 'rebaseline', reason: op.reason, data: { n, decision, changed } });
      return;
    }
    case 'release.add': {
      if (!plan.gates.release.approved) return refuse('gate release is not approved');
      const id = alloc(d, 'REL');
      d.plan.releases.push({
        id,
        version: op.version,
        at: ctx.now,
        baseline: d.plan.baseline,
        commit: op.commit,
        blocks: [...op.blocks],
      });
      d.created = id;
      emit(d, { type: 'release', data: { id, version: op.version, commit: op.commit } });
      return;
    }
    case 'renumber': {
      const num = (id: string) => Number(id.slice(id.indexOf('-') + 1));
      const max = (ids: string[]) => ids.reduce((m, id) => Math.max(m, num(id)), 0);
      const decisions = [
        ...Object.keys(plan.decisions ?? {}),
        ...plan.baselines.map((b) => b.decision),
        ...Object.values(plan.blocks).flatMap((b) => (b.retired ? [b.retired.decision] : [])),
        ...Object.values(plan.requirements).flatMap((r) => (r.retired ? [r.retired.decision] : [])),
      ];
      const need: Record<IdKind, number> = {
        R: max(Object.keys(plan.requirements)) + 1,
        B: max(Object.keys(plan.blocks)) + 1,
        D: max(decisions) + 1,
        REL: max(plan.releases.map((r) => r.id)) + 1,
      };
      // Counters only move up: ids are never reused.
      for (const k of Object.keys(need) as IdKind[])
        d.plan.nextId[k] = Math.max(d.plan.nextId[k], need[k]);
      return;
    }
  }
}

function revoke(d: Draft, gate: GateName, reason: string): void {
  const g = d.plan.gates[gate];
  d.plan.gates[gate] = { ...g, approved: false, revokedAt: d.ctx.now, revokedReason: reason };
  emit(d, { type: 'gate.revoke', reason, data: { gate } });
}

export function applyOp(input: PlanV1, op: Op, ctx: OpContext): OpResult {
  const d: Draft = { plan: structuredClone(input), ctx, events: [] };
  handle(d, op);
  d.plan.updatedAt = ctx.now;

  const revocations = gateRevocations(input, d.plan);
  for (const r of revocations) revoke(d, r.gate, r.reason);

  const errors = validatePlan(d.plan).filter((i) => i.level === 'error');
  if (hasErrors(errors)) {
    const hint =
      revocations.length > 0
        ? `gate ${revocations.map((r) => r.gate).join(', ')} would be revoked; use "phase back" first so currentPhase does not depend on it`
        : undefined;
    throw new PlanInvariantError(errors, hint);
  }
  return { plan: d.plan, events: d.events, ...(d.created ? { created: d.created } : {}) };
}
