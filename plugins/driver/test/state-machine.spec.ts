import { describe, expect, it } from 'vitest';
import { BLOCK_STATUSES, type BlockStatus, type PlanV1 } from '../src/schema.js';
import { TRANSITIONS, canTransition, gateRevocations } from '../src/state-machine.js';
import { HOOK, MODEL, USER, clonePlan } from './helpers.js';

const ID = 'B-009';

/** mid-implement plus one implement-phase block in the given state, ready to satisfy any guard. */
function withBlock(status: BlockStatus, over: Record<string, unknown> = {}): PlanV1 {
  const p = clonePlan();
  p.blocks[ID] = {
    title: 'Subject',
    phase: 'implement',
    status,
    statusSince: '2026-10-27T12:00:00Z',
    statusBy: MODEL,
    dependsOn: ['B-002'],
    requirements: [],
    artifacts: ['src/x.ts'],
    tests: [],
    verification: { passes: true, at: '2026-10-27T12:00:00Z', by: USER },
    ...(status === 'blocked' || status === 'needs_rework' ? { statusReason: 'r' } : {}),
    ...(status === 'in_progress' ? { owner: 'agent-1' } : {}),
    ...over,
  };
  p.nextId.B = 10;
  return p;
}

const ok = (p: PlanV1, to: BlockStatus, ctx: Parameters<typeof canTransition>[3]) =>
  canTransition(p, ID, to, ctx);

describe('TRANSITIONS table', () => {
  it('matches plan section 3', () => {
    const pairs = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(pairs).toEqual([
      'not_started>in_progress',
      'in_progress>in_review',
      'in_progress>blocked',
      'blocked>in_progress',
      'in_review>done',
      'in_review>needs_rework',
      'done>needs_rework',
      'needs_rework>in_progress',
      '*>not_started',
    ]);
  });

  // With every guard satisfied, the table alone decides who can go where.
  it.each(BLOCK_STATUSES.flatMap((from) => BLOCK_STATUSES.map((to) => [from, to] as const)))(
    'user %s -> %s allowed iff in table',
    (from, to) => {
      const p = withBlock(from);
      const inTable = TRANSITIONS.some((t) => t.from === from && t.to === to);
      const res = ok(p, to, { actor: USER, reason: 'because' });
      // to not_started needs the rebaseline flag; same-state is always refused
      expect(res.ok).toBe(inTable && to !== 'not_started');
    },
  );
});

describe('canTransition: allowed', () => {
  it.each([
    ['not_started', 'in_progress', MODEL],
    ['in_progress', 'in_review', MODEL],
    ['in_progress', 'blocked', MODEL],
    ['in_progress', 'blocked', HOOK],
    ['blocked', 'in_progress', MODEL],
    ['in_review', 'done', MODEL],
    ['in_review', 'needs_rework', MODEL],
    ['done', 'needs_rework', MODEL],
    ['needs_rework', 'in_progress', MODEL],
  ] as const)('%s -> %s by %s', (from, to, actor) => {
    expect(ok(withBlock(from), to, { actor, reason: 'why' })).toEqual({ ok: true });
  });

  it('user can move anything to not_started via rebaseline', () => {
    for (const s of BLOCK_STATUSES.filter((x) => x !== 'not_started'))
      expect(ok(withBlock(s), 'not_started', { actor: USER, rebaseline: true })).toEqual({ ok: true });
  });
});

describe('canTransition: refused', () => {
  const refused = (r: ReturnType<typeof canTransition>, re: RegExp) => {
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(re);
  };

  it('unknown block, retired block, same status', () => {
    refused(canTransition(clonePlan(), 'B-999', 'done', { actor: USER }), /unknown block/);
    const retired = withBlock('in_progress', { retired: { at: '2026-10-27T12:00:00Z', decision: 'D-001', reason: 'x' } });
    refused(ok(retired, 'blocked', { actor: USER, reason: 'r' }), /retired/);
    refused(ok(withBlock('done'), 'done', { actor: USER }), /already done/);
  });

  it('illegal pairs', () => {
    refused(ok(withBlock('not_started'), 'done', { actor: USER }), /illegal transition/);
    refused(ok(withBlock('in_progress'), 'done', { actor: USER }), /illegal transition/);
    refused(ok(withBlock('done'), 'in_progress', { actor: USER }), /illegal transition/);
  });

  it('wrong actor kind', () => {
    refused(ok(withBlock('not_started'), 'in_progress', { actor: HOOK }), /cannot move/);
    refused(ok(withBlock('in_review'), 'done', { actor: HOOK }), /cannot move/);
  });

  it('in_progress -> in_review needs artifacts', () => {
    refused(ok(withBlock('in_progress', { artifacts: [] }), 'in_review', { actor: MODEL }), /artifact/);
  });

  it('blocked and needs_rework need a reason', () => {
    refused(ok(withBlock('in_progress'), 'blocked', { actor: MODEL }), /reason/);
    refused(ok(withBlock('in_progress'), 'blocked', { actor: MODEL, reason: '  ' }), /reason/);
    refused(ok(withBlock('in_review'), 'needs_rework', { actor: MODEL }), /reason/);
    refused(ok(withBlock('done'), 'needs_rework', { actor: MODEL }), /reason/);
  });

  it('done needs passing verification and no failing test', () => {
    refused(ok(withBlock('in_review', { verification: undefined }), 'done', { actor: MODEL }), /verification/);
    refused(
      ok(withBlock('in_review', { verification: { passes: false, at: '2026-10-27T12:00:00Z', by: USER } }), 'done', { actor: MODEL }),
      /verification/,
    );
    const failing = withBlock('in_review', { tests: [{ ref: 't.ts', layer: 'unit', result: 'fail' }] });
    refused(ok(failing, 'done', { actor: MODEL }), /failing tests: t\.ts/);
  });

  it('not_started needs rebaseline and the user', () => {
    refused(ok(withBlock('done'), 'not_started', { actor: USER }), /rebaseline/);
    refused(ok(withBlock('done'), 'not_started', { actor: MODEL, rebaseline: true }), /rebaseline/);
  });

  it.each(['blocked', 'needs_rework'] as const)('cannot resume %s into a phase not reached', (status) => {
    const p = withBlock(status, { phase: 'validate', dependsOn: [] });
    refused(ok(p, 'in_progress', { actor: USER }), /currentPhase/);
  });

  it('cannot start a block from a phase not reached yet', () => {
    const p = withBlock('not_started', { phase: 'validate', dependsOn: [] });
    refused(ok(p, 'in_progress', { actor: USER, force: true }), /currentPhase/);
  });
});

describe('force rule', () => {
  const pending = () => withBlock('not_started', { dependsOn: ['B-003'] }); // B-003 is in_review

  it('dependencies must be done', () => {
    const r = ok(pending(), 'in_progress', { actor: MODEL });
    expect(r).toEqual({ ok: false, reason: 'dependencies not done: B-003' });
  });
  it('user force skips the dependency check', () => {
    expect(ok(pending(), 'in_progress', { actor: USER, force: true })).toEqual({ ok: true });
  });
  it('force without being user is refused', () => {
    const r = ok(pending(), 'in_progress', { actor: MODEL, force: true });
    expect(r).toEqual({ ok: false, reason: 'force is only allowed for the user' });
  });
  it('retired dependencies do not block', () => {
    const p = pending();
    p.blocks['B-003']!.retired = { at: '2026-10-27T12:00:00Z', decision: 'D-001', reason: 'x' };
    expect(ok(p, 'in_progress', { actor: MODEL })).toEqual({ ok: true });
  });
});

describe('gateRevocations', () => {
  const approvedRelease = (): PlanV1 => {
    const p = clonePlan();
    p.currentPhase = 'evolve';
    p.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    return p;
  };
  const next = (p: PlanV1, f: (x: PlanV1) => void): PlanV1 => {
    const q = structuredClone(p);
    f(q);
    return q;
  };

  it('nothing changed, nothing revoked', () => {
    const p = approvedRelease();
    expect(gateRevocations(p, structuredClone(p))).toEqual([]);
  });

  it('release: baseline increment', () => {
    const p = approvedRelease();
    const r = gateRevocations(p, next(p, (x) => void (x.baseline = 2)));
    expect(r).toEqual([{ gate: 'release', reason: 'baseline moved to 2' }]);
  });

  it('release: a block leaves done', () => {
    const p = approvedRelease();
    const r = gateRevocations(p, next(p, (x) => void (x.blocks['B-001']!.status = 'needs_rework')));
    expect(r).toEqual([{ gate: 'release', reason: 'B-001 left done' }]);
  });

  it.each(['evolve', 'release'] as const)('release: phase moves back from %s', (from) => {
    const p = approvedRelease();
    p.currentPhase = from;
    const r = gateRevocations(p, next(p, (x) => void (x.currentPhase = 'implement')));
    expect(r.map((x) => x.gate)).toEqual(['release']);
  });

  it('release: moving back from implement does not revoke', () => {
    const p = approvedRelease();
    p.currentPhase = 'implement';
    expect(gateRevocations(p, next(p, (x) => void (x.currentPhase = 'route')))).toEqual([]);
  });

  it('release: not reported when it is not approved', () => {
    const p = clonePlan();
    expect(gateRevocations(p, next(p, (x) => void (x.baseline = 2)))).toEqual([]);
  });

  it('route: phase back to discover', () => {
    const p = clonePlan();
    const r = gateRevocations(p, next(p, (x) => void (x.currentPhase = 'discover')));
    expect(r).toEqual([{ gate: 'route', reason: 'phase moved back to discover' }]);
  });

  it('requirement added or retired revokes release (baseline >= 1) but never route', () => {
    const p = approvedRelease();
    const added = next(p, (x) => void (x.requirements['R-004'] = { title: 'n', kind: 'functional', source: 'user' }));
    expect(gateRevocations(p, added)).toEqual([{ gate: 'release', reason: 'requirements changed' }]);
    const retired = next(p, (x) => void (x.requirements['R-001']!.retired = { at: '2026-10-28T10:00:00Z', decision: 'D-001', reason: 'x' }));
    expect(gateRevocations(p, retired)).toEqual([{ gate: 'release', reason: 'requirements changed' }]);
    const q = approvedRelease();
    q.baseline = 0;
    expect(gateRevocations(q, next(q, (x) => void (x.requirements['R-004'] = { title: 'n', kind: 'functional', source: 'user' })))).toEqual([]);
  });

  it('route: staying in discover is not a revocation', () => {
    const p = clonePlan('minimal-discover');
    p.gates.route.approved = true;
    expect(gateRevocations(p, structuredClone(p))).toEqual([]);
  });
});
