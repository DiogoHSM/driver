import { describe, expect, it } from 'vitest';
import { project, shapeCheck, summarize } from '../src/shared/view.js';
import { clonePlan, loadExamplePlan, loadFixture, shuffleKeys } from './helpers.js';
import { docBlock, docPlan } from './shared-helpers.js';

describe('project', () => {
  it('projects a plan into sorted block views', () => {
    const plan = loadExamplePlan('web-waitlist');
    const v = project(plan);
    expect(v).toMatchObject({ project: 'web-waitlist', baseline: 1, currentPhase: 'implement' });
    expect(v.gates.route).toMatchObject({ approved: true, by: 'diogo' });
    expect(v.gates.release).toEqual({ approved: false });
    expect(v.blocks.map((b) => b.id)).toEqual(['B-001', 'B-002', 'B-003', 'B-004', 'B-005', 'B-006', 'B-007', 'B-008']);
    expect(v.blocks[3]).toMatchObject({
      id: 'B-004', title: 'Signup API', phase: 'implement', status: 'in_review', deps: ['B-003'], reqs: 1, risk: 'medium', retired: false,
      tests: { pass: 1, fail: 0, unknown: 0 },
    });
    expect(v.blocks[2]!.verified).toBe(true);
    expect(v.blocks[3]!.verified).toBeUndefined();
    expect(JSON.stringify(project(shuffleKeys(plan, true)))).toBe(JSON.stringify(v));
  });

  it('orders ids numerically and keeps owner, reason and retired flags', () => {
    const v = project(docPlan({
      'B-1000': docBlock({ title: 'z', phase: 'implement' }),
      'B-999': docBlock({ title: 'y', phase: 'implement', status: 'blocked', statusReason: 'r', owner: 'a' }),
      'B-002': docBlock({ title: 'x', phase: 'implement', retired: { at: 't', decision: 'D-001', reason: 'r' } }),
    }));
    expect(v.blocks.map((b) => b.id)).toEqual(['B-002', 'B-999', 'B-1000']);
    expect(v.blocks[1]).toMatchObject({ reason: 'r', owner: 'a' });
    expect(v.blocks[0]!.retired).toBe(true);
  });
});

describe('summarize', () => {
  it('counts, finds ready, in-progress and blocked blocks, and the next gate', () => {
    const s = summarize(project(clonePlan('mid-implement') as never));
    expect(s.counts.done + s.counts.not_started + s.counts.in_progress + s.counts.blocked + s.counts.in_review + s.counts.needs_rework).toBe(
      Object.values(clonePlan('mid-implement').blocks).filter((b) => !b.retired).length,
    );
    expect(s.nextGate).toBe('release');
  });

  it('ready = not_started, deps done, phase at or before the current one', () => {
    const doc = docPlan(
      {
        'B-001': docBlock({ title: 'a', phase: 'implement', status: 'done' }),
        'B-002': docBlock({ title: 'b', phase: 'implement', dependsOn: ['B-001'] }),
        'B-003': docBlock({ title: 'c', phase: 'implement', dependsOn: ['B-002'] }),
        'B-004': docBlock({ title: 'd', phase: 'validate', dependsOn: ['B-001'] }), // later phase
        'B-005': docBlock({ title: 'e', phase: 'implement' }),
        'B-006': docBlock({ title: 'f', phase: 'implement', status: 'in_progress', owner: 'agent-1' }),
        'B-007': docBlock({ title: 'g', phase: 'implement', status: 'blocked', statusReason: 'waiting' }),
        'B-008': docBlock({ title: 'h', phase: 'implement', retired: { at: 't', decision: 'D-001', reason: 'r' } }),
        'B-009': docBlock({ title: 'i', phase: 'implement', dependsOn: ['B-008'] }), // retired dep counts as met
        'B-010': docBlock({ title: 'j', phase: 'implement', dependsOn: ['B-404'] }), // unknown dep is unmet
      },
      { gates: { route: { approved: true }, release: { approved: true } } },
    );
    const s = summarize(project(doc));
    expect(s.ready).toEqual(['B-002', 'B-005', 'B-009']);
    expect(s.inProgress).toEqual([{ id: 'B-006', owner: 'agent-1' }]);
    expect(s.blocked).toEqual([{ id: 'B-007', reason: 'waiting' }]);
    expect(s.counts.not_started).toBe(6);
    expect(s.nextGate).toBeUndefined();
    expect(summarize(project(docPlan({}, { gates: { route: { approved: false }, release: { approved: false } } }))).nextGate).toBe('route');
  });
});

describe('shapeCheck', () => {
  it('accepts valid plans', () => {
    for (const n of ['minimal-discover', 'mid-implement'] as const) expect(shapeCheck(loadFixture('valid', n)).ok).toBe(true);
    expect(shapeCheck(loadExamplePlan('video-explainer')).ok).toBe(true);
  });

  it('rejects structurally broken input with a message', () => {
    const base = () => structuredClone(loadFixture('valid', 'mid-implement'));
    const cases: [string, (p: any) => unknown, RegExp][] = [
      ['not an object', () => [], /not an object/],
      ['null', () => null, /not an object/],
      ['schemaVersion', (p) => ({ ...p, schemaVersion: 2 }), /schemaVersion/],
      ['project', (p) => ({ ...p, project: null }), /project/],
      ['revision', (p) => ({ ...p, revision: '3' }), /revision/],
      ['phase', (p) => ({ ...p, currentPhase: 'nope' }), /currentPhase/],
      ['gates', (p) => ({ ...p, gates: {} }), /gates/],
      ['blocks', (p) => ({ ...p, blocks: [] }), /blocks/],
      ['block id', (p) => ({ ...p, blocks: { 'B-x': p.blocks['B-001'] } }), /malformed block id/],
      ['status', (p) => { p.blocks['B-001'].status = 'weird'; return p; }, /status invalid/],
      ['block phase', (p) => { p.blocks['B-001'].phase = 'weird'; return p; }, /phase invalid/],
      ['dependsOn', (p) => { p.blocks['B-001'].dependsOn = 'B-002'; return p; }, /dependsOn/],
    ];
    for (const [, mut, re] of cases) {
      const r = shapeCheck(mut(base()));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(re);
    }
  });
});
