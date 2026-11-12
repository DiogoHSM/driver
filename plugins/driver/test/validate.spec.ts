import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../src/schema.js';
import { hasErrors, validatePlan } from '../src/validate.js';
import { loadFixture } from './helpers.js';

const expected: [string, string][] = [
  ['cycle', 'deps.cycle'],
  ['dangling-dependson', 'ref.dependsOn'],
  ['dangling-requirement', 'ref.requirement'],
  ['nextid-too-low', 'ids.nextId'],
  ['blocked-without-reason', 'status.reason'],
  ['owner-on-done', 'status.owner'],
  ['implement-route-unapproved', 'gate.route'],
  ['release-gate-unapproved', 'gate.release'],
  ['release-incomplete', 'gate.releaseIncomplete'],
  ['depends-later-phase', 'deps.laterPhase'],
  ['bad-credential', 'schema'],
  ['bad-id-format', 'schema'],
  ['schema-version-2', 'schema'],
];

describe('validatePlan', () => {
  it.each(['minimal-discover', 'mid-implement'])('valid fixture %s has no issues', (name) => {
    expect(validatePlan(loadFixture('valid', name))).toEqual([]);
  });

  it.each(expected)('invalid fixture %s produces %s', (name, code) => {
    const issues = validatePlan(loadFixture('invalid', name));
    expect(issues.map((i) => i.code)).toContain(code);
    expect(hasErrors(issues)).toBe(true);
  });

  it('future-phase-started is a warning, not an error', () => {
    const issues = validatePlan(loadFixture('invalid', 'future-phase-started'));
    expect(issues.find((i) => i.code === 'phases.currentValid')).toMatchObject({ level: 'warning' });
    expect(hasErrors(issues)).toBe(false);
  });

  it('open-behind is a warning in evolve and release, naming the blocks, and silent earlier or when all is done', () => {
    const plan = loadFixture('invalid', 'open-behind');
    const issues = validatePlan(plan);
    const w = issues.find((i) => i.code === 'phases.openBehind');
    expect(w).toMatchObject({ level: 'warning' });
    expect(w!.message).toContain('B-003, B-004, B-005');
    expect(w!.message).not.toContain('B-006');
    expect(hasErrors(issues)).toBe(false);
    plan.currentPhase = 'release';
    plan.gates.release = { approved: true, approvedAt: '2026-10-27T12:00:00Z', approvedBy: 'diogo', atBaseline: 1 };
    const late = validatePlan(plan);
    expect(late.find((i) => i.code === 'phases.openBehind')).toMatchObject({ level: 'warning' });
    expect(late.find((i) => i.code === 'gate.releaseIncomplete')).toMatchObject({ level: 'error' });
    plan.currentPhase = 'validate';
    expect(validatePlan(plan).map((i) => i.code)).not.toContain('phases.openBehind');
    plan.currentPhase = 'evolve';
    for (const id of ['B-003', 'B-004', 'B-005']) {
      plan.blocks[id].status = 'done';
      delete plan.blocks[id].statusReason;
    }
    expect(validatePlan(plan).map((i) => i.code)).not.toContain('phases.openBehind');
  });

  it('req.coverage is a warning everywhere except release', () => {
    const plan = loadFixture('invalid', 'req-uncovered');
    const early = validatePlan(plan);
    expect(early.find((i) => i.code === 'req.coverage')).toMatchObject({ level: 'warning' });
    expect(hasErrors(early)).toBe(false);
    plan.currentPhase = 'evolve';
    expect(validatePlan(plan).find((i) => i.code === 'req.coverage')).toMatchObject({ level: 'warning' });
    plan.currentPhase = 'release';
    const late = validatePlan(plan);
    expect(late.find((i) => i.code === 'req.coverage')).toMatchObject({ level: 'error' });
  });

  it('stops at schema errors', () => {
    const issues = validatePlan(loadFixture('invalid', 'schema-version-2'));
    expect(issues.every((i) => i.code === 'schema')).toBe(true);
  });

  it('flags bad credential names at their path', () => {
    const issues = validatePlan(loadFixture('invalid', 'bad-credential'));
    expect(issues[0]?.path).toBe('blocks.B-004.provider.credentials.0');
  });

  it('rejects non-objects', () => {
    expect(hasErrors(validatePlan(null))).toBe(true);
  });

  it('downgrades req.coverage to a warning in discover', () => {
    const plan = emptyPlan('x', [], '2026-10-27T12:00:00Z');
    plan.requirements['R-001'] = { title: 'Orphan', kind: 'functional', source: 'user' };
    plan.nextId.R = 2;
    const issues = validatePlan(plan);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'warning', code: 'req.coverage' });
    expect(hasErrors(issues)).toBe(false);
  });

  it('ignores non-goals and retired items for coverage', () => {
    const plan = emptyPlan('x', [], '2026-10-27T12:00:00Z');
    plan.requirements['R-001'] = { title: 'No SSO', kind: 'non-goal', source: 'user' };
    plan.requirements['R-002'] = {
      title: 'Old',
      kind: 'functional',
      source: 'user',
      retired: { at: '2026-10-27T12:00:00Z', decision: 'D-001', reason: 'dropped' },
    };
    plan.nextId.R = 3;
    plan.nextId.D = 2;
    delete plan.decisions; // legacy plan
    expect(validatePlan(plan)).toEqual([]);
  });

  it('checks block docs only when fs is provided', () => {
    const plan = loadFixture('valid', 'mid-implement');
    expect(validatePlan(plan)).toEqual([]);
    const missing = validatePlan(plan, { fs: { exists: () => false }, driverDir: '/p/.claude/driver' });
    expect(missing.filter((i) => i.code === 'doc.missing')).toHaveLength(7);
    const present = validatePlan(plan, { fs: { exists: () => true }, driverDir: '/p/.claude/driver' });
    expect(present).toEqual([]);
  });

  it('reports a cycle once, naming the blocks involved', () => {
    const issues = validatePlan(loadFixture('invalid', 'cycle')).filter((i) => i.code === 'deps.cycle');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('B-003');
  });
});

describe('ref.decision', () => {
  it('flags cited decisions missing from decisions, only when decisions is present', () => {
    const plan = loadFixture('valid', 'mid-implement');
    expect(validatePlan(plan)).toEqual([]); // legacy plan without decisions
    plan.decisions = {};
    const issues = validatePlan(plan);
    expect(issues.filter((i) => i.code === 'ref.decision').map((i) => i.path)).toEqual(['baselines.0.decision']);
    plan.decisions = { 'D-001': { title: 't', at: '2026-10-27T12:00:00Z', by: { kind: 'user', id: 'diogo' } } };
    expect(validatePlan(plan).filter((i) => i.code === 'ref.decision')).toEqual([]);
  });
});
