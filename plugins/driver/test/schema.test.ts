import { describe, expect, it } from 'vitest';
import {
  BLOCK_STATUSES,
  PHASES,
  PLAN_SCHEMA_URL,
  PlanV1Schema,
  comparePhase,
  emptyPlan,
  phaseIndex,
} from '../src/schema.js';
import { loadFixture } from './helpers.js';

describe('schema', () => {
  it('exposes ordered phases and statuses', () => {
    expect(PHASES).toEqual(['discover', 'route', 'implement', 'validate', 'evolve', 'release']);
    expect(BLOCK_STATUSES).toHaveLength(6);
    expect(PLAN_SCHEMA_URL).toBe('./schema/plan.v1.schema.json');
  });

  it('orders phases', () => {
    expect(phaseIndex('release')).toBe(5);
    expect(comparePhase('route', 'validate')).toBeLessThan(0);
    expect(comparePhase('evolve', 'evolve')).toBe(0);
  });

  it('builds a valid empty plan', () => {
    const plan = emptyPlan('demo', ['driver-web'], '2026-10-27T12:00:00Z');
    expect(plan.currentPhase).toBe('discover');
    expect(plan.revision).toBe(0);
    expect(plan.nextId).toEqual({ R: 1, B: 1, D: 1, REL: 1 });
    expect(PlanV1Schema.safeParse(plan).success).toBe(true);
  });

  it.each(['minimal-discover', 'mid-implement'])('accepts fixture %s', (name) => {
    expect(PlanV1Schema.safeParse(loadFixture('valid', name)).success).toBe(true);
  });

  it('accepts timestamps with offsets and optional $schema', () => {
    const plan = { ...emptyPlan('x', [], '2026-10-27T12:00:00-03:00'), $schema: PLAN_SCHEMA_URL };
    expect(PlanV1Schema.safeParse(plan).success).toBe(true);
  });

  it('ignores unknown fields without stripping them', () => {
    const plan = { ...loadFixture('valid', 'mid-implement'), futureField: 1 };
    plan.blocks['B-001'].estimate = 3;
    const r = PlanV1Schema.safeParse(plan);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as any).futureField).toBe(1);
      expect((r.data.blocks['B-001'] as any).estimate).toBe(3);
    }
  });

  it.each([
    ['bad-id-format'],
    ['schema-version-2'],
    ['bad-credential'],
  ])('rejects invalid fixture %s', (name) => {
    expect(PlanV1Schema.safeParse(loadFixture('invalid', name)).success).toBe(false);
  });
});
