import { describe, expect, it } from 'vitest';
import { OpRefusedError, PlanInvariantError, applyOp, type Op } from '../src/reducer.js';
import { emptyPlan, type Actor, type PlanV1 } from '../src/schema.js';
import { hasErrors, validatePlan } from '../src/validate.js';
import { MODEL, NOW, USER, clonePlan, deepFreeze } from './helpers.js';

const T0 = '2026-10-20T09:00:00Z';

function run(plan: PlanV1, op: Op, actor: Actor = MODEL, now = NOW) {
  return applyOp(plan, op, { actor, now });
}

/** Chains ops, returning the final plan. */
function chain(start: PlanV1, steps: [Op, Actor?][]): PlanV1 {
  return steps.reduce((p, [op, actor]) => run(p, op, actor ?? MODEL).plan, start);
}

const fresh = () => emptyPlan('demo', ['driver-web'], T0);

describe('applyOp: happy paths', () => {
  it('req.add allocates ids and stamps updatedAt, not revision', () => {
    const r = run(fresh(), { type: 'req.add', title: 'Join', kind: 'functional', source: 'user', ref: 'x.md' });
    expect(r.created).toBe('R-001');
    expect(r.plan.requirements['R-001']).toEqual({ title: 'Join', kind: 'functional', source: 'user', ref: 'x.md' });
    expect(r.plan.nextId.R).toBe(2);
    expect(r.plan.updatedAt).toBe(NOW);
    expect(r.plan.revision).toBe(0);
    expect(r.events).toEqual([
      { ts: NOW, actor: MODEL, type: 'req.add', data: { id: 'R-001', title: 'Join' } },
    ]);
  });

  it('block.add creates a not_started block', () => {
    const r = run(fresh(), { type: 'block.add', title: 'Interview', phase: 'discover', risk: 'low' });
    expect(r.created).toBe('B-001');
    expect(r.plan.blocks['B-001']).toMatchObject({
      title: 'Interview',
      phase: 'discover',
      status: 'not_started',
      statusSince: NOW,
      statusBy: MODEL,
      dependsOn: [],
      artifacts: [],
      tests: [],
      risk: 'low',
    });
    expect(r.events[0]).toMatchObject({ type: 'block.add', block: 'B-001' });
  });

  it('block.set patches fields, appends artifacts and upserts tests', () => {
    const p = run(fresh(), { type: 'block.add', title: 'A', phase: 'discover' }).plan;
    const r = run(p, {
      type: 'block.set',
      id: 'B-001',
      patch: { title: 'A2', addArtifacts: ['a.md', 'b.md'], addTests: [{ ref: 't', layer: 'unit', result: 'unknown' }] },
    });
    const r2 = run(r.plan, {
      type: 'block.set',
      id: 'B-001',
      patch: { addArtifacts: ['b.md', 'c.md'], addTests: [{ ref: 't', layer: 'unit', result: 'pass' }] },
    });
    const b = r2.plan.blocks['B-001']!;
    expect(b.title).toBe('A2');
    expect(b.artifacts).toEqual(['a.md', 'b.md', 'c.md']);
    expect(b.tests).toEqual([{ ref: 't', layer: 'unit', result: 'pass', at: NOW }]);
    expect(r2.events[0]).toMatchObject({ type: 'block.set', data: { fields: ['artifacts', 'tests'] } });
  });

  it('block.status stamps fields and tracks the owner', () => {
    const p = run(fresh(), { type: 'block.add', title: 'A', phase: 'discover' }).plan;
    const started = run(p, { type: 'block.status', id: 'B-001', to: 'in_progress' }, MODEL, '2026-10-28T11:00:00Z');
    expect(started.plan.blocks['B-001']).toMatchObject({
      status: 'in_progress',
      statusSince: '2026-10-28T11:00:00Z',
      statusBy: MODEL,
      owner: 'agent-1',
    });
    expect(started.events[0]).toMatchObject({ type: 'block.status', block: 'B-001', from: 'not_started', to: 'in_progress' });

    const blocked = run(started.plan, { type: 'block.status', id: 'B-001', to: 'blocked', reason: 'waiting' });
    const b = blocked.plan.blocks['B-001']!;
    expect(b.status).toBe('blocked');
    expect(b.statusReason).toBe('waiting');
    expect(b.owner).toBeUndefined();

    const resumed = run(blocked.plan, { type: 'block.status', id: 'B-001', to: 'in_progress' }, USER);
    expect(resumed.plan.blocks['B-001']!.statusReason).toBeUndefined();
    expect(resumed.plan.blocks['B-001']!.owner).toBe('diogo');
  });

  it('block.status refuses invalid transitions with OpRefusedError', () => {
    const p = run(fresh(), { type: 'block.add', title: 'A', phase: 'discover' }).plan;
    expect(() => run(p, { type: 'block.status', id: 'B-001', to: 'done' })).toThrow(OpRefusedError);
    const started = run(p, { type: 'block.status', id: 'B-001', to: 'in_progress' }).plan;
    expect(() => run(started, { type: 'block.status', id: 'B-001', to: 'not_started' }, USER)).toThrow(/rebaseline/);
  });

  it('leaving done clears verification so rework cannot skip review', () => {
    const r = run(clonePlan(), { type: 'block.status', id: 'B-001', to: 'needs_rework', reason: 'redo' });
    expect(r.plan.blocks['B-001']!.verification).toBeUndefined();
  });

  it('req.retire records the retirement (before gate 1)', () => {
    const p = chain(fresh(), [
      [{ type: 'req.add', title: 'R', kind: 'functional', source: 'user' }],
      [{ type: 'decision.add', title: 'one' }],
      [{ type: 'decision.add', title: 'two' }],
    ]);
    const r = run(p, { type: 'req.retire', id: 'R-001', decision: 'D-002', reason: 'out of scope' }, USER);
    expect(r.plan.requirements['R-001']!.retired).toEqual({ at: NOW, decision: 'D-002', reason: 'out of scope' });
    expect(r.events[0]).toMatchObject({ type: 'retire', data: { id: 'R-001', decision: 'D-002' } });
    expect(() => run(p, { type: 'req.retire', id: 'R-001', decision: 'D-009', reason: 'x' })).toThrow(/ids\.nextId|nextId/);
  });

  it('block.retire records the retirement and refuses retiring in_progress', () => {
    const p = clonePlan();
    p.nextId.D = 3;
    const r = run(p, { type: 'block.retire', id: 'B-007', decision: 'D-002', reason: 'dropped' });
    expect(r.plan.blocks['B-007']!.retired).toMatchObject({ decision: 'D-002' });
    expect(r.events[0]).toMatchObject({ type: 'retire', block: 'B-007' });
    // uncovering a requirement is only a warning before the validate phase
    expect(run(p, { type: 'block.retire', id: 'B-004', decision: 'D-002', reason: 'x' }).plan.blocks['B-004']!.retired).toBeDefined();
    const q = clonePlan();
    q.blocks['B-004']!.status = 'in_progress';
    delete q.blocks['B-004']!.statusReason;
    q.blocks['B-004']!.owner = 'x';
    expect(() => run(q, { type: 'block.retire', id: 'B-004', decision: 'D-001', reason: 'x' })).toThrow(/in_progress/);
  });

  it('block.orphan blocks every in_progress block of the owner', () => {
    let p = fresh();
    p = chain(p, [
      [{ type: 'block.add', title: 'A', phase: 'discover' }],
      [{ type: 'block.add', title: 'B', phase: 'discover' }],
      [{ type: 'block.add', title: 'C', phase: 'discover' }],
      [{ type: 'block.status', id: 'B-001', to: 'in_progress' }],
      [{ type: 'block.status', id: 'B-002', to: 'in_progress' }, { kind: 'model', id: 'other' }],
    ]);
    const r = run(p, { type: 'block.orphan', owner: 'agent-1' }, { kind: 'hook', id: 'subagent-stop' });
    expect(r.plan.blocks['B-001']).toMatchObject({ status: 'blocked', statusReason: 'agent ended without handoff', statusBy: { kind: 'hook' } });
    expect(r.plan.blocks['B-001']!.owner).toBeUndefined();
    expect(r.plan.blocks['B-002']!.status).toBe('in_progress');
    expect(r.plan.blocks['B-003']!.status).toBe('not_started');
    expect(r.events.map((e) => e.type)).toEqual(['block.status', 'orphan']);
  });

  it('gate.approve route at baseline 0 creates baseline 1 and a decision', () => {
    const p = chain(fresh(), [
      [{ type: 'req.add', title: 'R', kind: 'functional', source: 'user' }],
      [{ type: 'block.add', title: 'A', phase: 'discover', requirements: ['R-001'] }],
    ]);
    const r = run(p, { type: 'gate.approve', gate: 'route' }, USER);
    expect(r.created).toBe('D-001');
    expect(r.plan.baseline).toBe(1);
    expect(r.plan.baselines).toEqual([
      { n: 1, at: NOW, decision: 'D-001', reason: 'Gate 1: route approved', added: ['B-001'], retired: [], changed: [], reqAdded: ['R-001'], reqRetired: [] },
    ]);
    expect(r.plan.gates.route).toEqual({ approved: true, approvedAt: NOW, approvedBy: 'diogo', atBaseline: 1 });
    expect(r.plan.nextId.D).toBe(2);
    expect(r.events[0]).toMatchObject({ type: 'gate.approve', data: { gate: 'route', baseline: 1, decision: 'D-001' } });
  });

  it('phase.advance and phase.back', () => {
    let p = run(fresh(), { type: 'gate.approve', gate: 'route' }, USER).plan;
    p = run(p, { type: 'phase.advance' }).plan;
    expect(p.currentPhase).toBe('route');
    p = run(p, { type: 'phase.advance' }).plan;
    const back = run(p, { type: 'phase.back', to: 'route', reason: 'rethink' });
    expect(back.plan.currentPhase).toBe('route');
    expect(back.events[0]).toMatchObject({ type: 'phase.change', from: 'implement', to: 'route', reason: 'rethink' });
    expect(() => run(back.plan, { type: 'phase.back', to: 'implement', reason: 'x' })).toThrow(/not before/);
    expect(() => run(back.plan, { type: 'phase.back', to: 'discover', reason: ' ' })).toThrow(/reason/);
  });

  it('rebaseline bumps the baseline, resets changed blocks and revokes release', () => {
    const p = clonePlan();
    p.currentPhase = 'evolve';
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    const r = run(p, { type: 'rebaseline', reason: 'new scope', changed: ['B-003'] }, USER);
    expect(r.created).toBe('D-002');
    expect(r.plan.baseline).toBe(2);
    expect(r.plan.baselines[1]).toMatchObject({ n: 2, decision: 'D-002', reason: 'new scope', changed: ['B-003'], added: [] });
    expect(r.plan.blocks['B-003']!.status).toBe('not_started');
    expect(r.plan.gates.release).toMatchObject({ approved: false, revokedAt: NOW, revokedReason: 'baseline moved to 2' });
    expect(r.plan.gates.route.approved).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(['block.status', 'rebaseline', 'gate.revoke']);
  });

  it('release.add records the release', () => {
    const p = clonePlan();
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    const r = run(p, { type: 'release.add', version: '0.1.0', commit: 'abc1234', blocks: ['B-001', 'B-002'] });
    expect(r.created).toBe('REL-1');
    expect(r.plan.releases[0]).toEqual({ id: 'REL-1', version: '0.1.0', at: NOW, baseline: 1, commit: 'abc1234', blocks: ['B-001', 'B-002'] });
    expect(() => run(clonePlan(), { type: 'release.add', version: '1', commit: 'a', blocks: [] })).toThrow(/not approved/);
  });

  it('renumber raises low counters and never lowers them', () => {
    const p = clonePlan();
    p.nextId.B = 3; // too low: max existing is 7
    p.nextId.R = 50;
    const r = run(p, { type: 'renumber' });
    expect(r.plan.nextId.B).toBe(8);
    expect(r.plan.nextId.R).toBe(50);
  });
});

describe('applyOp: invariants and purity', () => {
  it('invalid result throws PlanInvariantError and leaves the frozen input untouched', () => {
    const input = deepFreeze(clonePlan());
    const snapshot = JSON.stringify(input);
    let err: unknown;
    try {
      run(input, { type: 'block.add', title: 'Bad', phase: 'implement', dependsOn: ['B-999'] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PlanInvariantError);
    expect((err as PlanInvariantError).issues.map((i) => i.code)).toContain('ref.dependsOn');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('successful ops do not mutate a frozen input either', () => {
    const input = deepFreeze(clonePlan());
    const r = run(input, { type: 'block.add', title: 'Ok', phase: 'validate' });
    expect(r.plan).not.toBe(input);
    expect(input.blocks['B-008']).toBeUndefined();
    expect(hasErrors(validatePlan(r.plan))).toBe(false);
  });

  it('req.add after gate 1 succeeds in implement and keeps route approved', () => {
    const r = run(clonePlan(), { type: 'req.add', title: 'New', kind: 'functional', source: 'user' });
    expect(r.created).toBe('R-004');
    expect(r.plan.gates.route.approved).toBe(true);
    expect(validatePlan(r.plan).find((i) => i.code === 'req.coverage')).toMatchObject({ level: 'warning' });
  });

  it('req.add / req.retire revoke an approved release gate with "requirements changed"', () => {
    const p = clonePlan();
    p.nextId.D = 3;
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    const added = run(p, { type: 'req.add', title: 'New', kind: 'functional', source: 'user' });
    expect(added.plan.gates.release).toMatchObject({ approved: false, revokedReason: 'requirements changed' });
    expect(added.events.map((e) => e.type)).toEqual(['req.add', 'gate.revoke']);
    const retired = run(p, { type: 'req.retire', id: 'R-003', decision: 'D-002', reason: 'x' });
    expect(retired.plan.gates.release.approved).toBe(false);
    expect(retired.plan.gates.route.approved).toBe(true);
  });

  it('phase.back succeeds with later blocks already done', () => {
    const r = run(clonePlan(), { type: 'phase.back', to: 'route', reason: 'rethink' });
    expect(r.plan.currentPhase).toBe('route');
    expect(r.plan.blocks['B-003']!.status).toBe('in_review');
  });

  it('phase.back to discover revokes route', () => {
    const r = run(clonePlan(), { type: 'phase.back', to: 'discover', reason: 'restart' });
    expect(r.plan.gates.route).toMatchObject({ approved: false, revokedReason: 'phase moved back to discover' });
  });

  it('req.add while still in discover with the gate unapproved is fine', () => {
    const r = run(clonePlan('minimal-discover'), { type: 'req.add', title: 'New', kind: 'functional', source: 'user' });
    expect(r.created).toMatch(/^R-/);
  });
});

describe('applyOp: hardening', () => {
  it('block.set refuses keys outside the whitelist (status, phase, owner, retired) as forbidden', () => {
    const p = run(fresh(), { type: 'block.add', title: 'A', phase: 'discover' }).plan;
    for (const patch of [{ status: 'done' }, { phase: 'release' }, { owner: 'x' }, { retired: {} }]) {
      let err: unknown;
      try {
        run(p, { type: 'block.set', id: 'B-001', patch: patch as never });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(OpRefusedError);
      expect((err as OpRefusedError).forbidden).toBe(true);
    }
  });

  it('block.status in_progress honors an explicit owner (platform agent id)', () => {
    const p = run(fresh(), { type: 'block.add', title: 'A', phase: 'discover' }).plan;
    const r = run(p, { type: 'block.status', id: 'B-001', to: 'in_progress', owner: 'agent-77' });
    expect(r.plan.blocks['B-001']!.owner).toBe('agent-77');
  });

  it('req.add works in evolve (coverage is only an error in release)', () => {
    const p = clonePlan();
    p.currentPhase = 'evolve';
    const r = run(p, { type: 'req.add', title: 'Late', kind: 'functional', source: 'user' });
    expect(r.created).toBe('R-004');
  });

  it('decision.add allocates and registers; gate approve and rebaseline register theirs', () => {
    const d = run(fresh(), { type: 'decision.add', title: 'Drop it', reason: 'scope' }, USER);
    expect(d.created).toBe('D-001');
    expect(d.plan.decisions!['D-001']).toEqual({ title: 'Drop it', at: NOW, reason: 'scope', by: USER });
    const g = run(fresh(), { type: 'gate.approve', gate: 'route' }, USER);
    expect(g.plan.decisions!['D-001']).toMatchObject({ title: 'Gate 1: route approved', by: USER });
    const rb = run(clonePlan(), { type: 'rebaseline', reason: 'scope' }, USER);
    // legacy plan (no registry yet): created on first use, citing the old baseline decision too
    expect(Object.keys(rb.plan.decisions!).sort()).toEqual(['D-001', 'D-002']);
  });

  it('rebaseline on a plan with decisions registers the auto decision', () => {
    const p = run(fresh(), { type: 'gate.approve', gate: 'route' }, USER).plan;
    const rb = run(p, { type: 'rebaseline', reason: 'scope' }, USER);
    expect(rb.plan.decisions!['D-002']).toMatchObject({ reason: 'scope' });
  });

  it('retiring with an unregistered decision is refused; with a real one it works before Gate 1', () => {
    const p = chain(fresh(), [
      [{ type: 'block.add', title: 'A', phase: 'discover' }],
      [{ type: 'decision.add', title: 'Drop' }, USER],
    ]);
    expect(() => run(p, { type: 'block.retire', id: 'B-001', decision: 'D-009', reason: 'x' })).toThrow(PlanInvariantError);
    expect(run(p, { type: 'block.retire', id: 'B-001', decision: 'D-001', reason: 'x' }).plan.blocks['B-001']!.retired).toBeDefined();
  });
});

describe('applyOp: guards', () => {
  it('gate.approve by a model actor is refused as forbidden', () => {
    let err: unknown;
    try {
      run(fresh(), { type: 'gate.approve', gate: 'route' }, MODEL);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OpRefusedError);
    expect((err as OpRefusedError).forbidden).toBe(true);
    expect((err as Error).message).toBe('gate approval is user-only');
  });

  it('gate.approve release needs route first, and double approval is refused', () => {
    expect(() => run(fresh(), { type: 'gate.approve', gate: 'release' }, USER)).toThrow(/route/);
    expect(() => run(clonePlan(), { type: 'gate.approve', gate: 'route' }, USER)).toThrow(/already approved/);
  });

  it('phase.advance refused without the gate', () => {
    expect(() => run(fresh(), { type: 'phase.advance' })).toThrow(/gate route is not approved/);
    const p = clonePlan();
    p.currentPhase = 'evolve';
    expect(() => run(p, { type: 'phase.advance' })).toThrow(/gate release is not approved/);
  });

  it('phase.advance refused past release', () => {
    const p = clonePlan();
    p.currentPhase = 'release';
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    for (const b of Object.values(p.blocks)) {
      b.status = 'done';
      delete b.owner;
      delete b.statusReason;
      b.verification = { passes: true, at: '2026-10-27T12:00:00Z', by: USER };
    }
    expect(() => run(p, { type: 'phase.advance' })).toThrow(/last phase/);
  });

  it('rebaseline is user-only and needs a baseline', () => {
    expect(() => run(clonePlan(), { type: 'rebaseline', reason: 'x' }, MODEL)).toThrow(/user-only/);
    expect(() => run(fresh(), { type: 'rebaseline', reason: 'x' }, USER)).toThrow(/no baseline/);
  });

  it('rebaseline in the release phase is refused rather than leaving release without its gate', () => {
    const p = clonePlan();
    p.currentPhase = 'release';
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    for (const b of Object.values(p.blocks)) {
      b.status = 'done';
      delete b.owner;
      delete b.statusReason;
      b.verification = { passes: true, at: '2026-10-27T12:00:00Z', by: USER };
    }
    expect(hasErrors(validatePlan(p))).toBe(false);
    expect(() => run(p, { type: 'rebaseline', reason: 'x' }, USER)).toThrow(/phase back/);
  });

  it('unknown ids are refused', () => {
    expect(() => run(clonePlan(), { type: 'block.set', id: 'B-099', patch: { title: 'x' } })).toThrow(OpRefusedError);
    expect(() => run(clonePlan(), { type: 'req.retire', id: 'R-099', decision: 'D-001', reason: 'x' })).toThrow(OpRefusedError);
  });
});
