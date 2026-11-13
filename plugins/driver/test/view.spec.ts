import { describe, expect, it } from 'vitest';
import { baselineText, isResumable, project, shapeCheck, sinceBaseline, summarize } from '../src/shared/view.js';
import { clonePlan, loadExamplePlan, loadFixture, shuffleKeys } from './helpers.js';
import { docBlock, docPlan, loopedDoc } from './shared-helpers.js';

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

describe('ADR-016 derived fields', () => {
  const baselines = [{ n: 1, added: ['B-001', 'B-002'], reqAdded: ['R-001'], closedAt: 't' }];
  const retiredMark = { at: 't', decision: 'D-001', reason: 'r' };

  it('marks blocks and counts requirements that entered after the baseline', () => {
    const doc = docPlan(
      {
        'B-001': docBlock({ title: 'a', phase: 'implement', status: 'done' }),
        'B-002': docBlock({ title: 'b', phase: 'implement' }),
        'B-003': docBlock({ title: 'c', phase: 'implement' }),
      },
      {
        baselines,
        requirements: { 'R-001': { title: 'a' }, 'R-002': { title: 'b' }, 'R-003': { title: 'c', retired: {} } },
      },
    );
    const v = project(doc);
    expect(v.blocks.map((b) => b.afterBaseline)).toEqual([undefined, undefined, true]);
    expect(v.reqsAfterBaseline).toBe(1);
    // a later baseline folds the new ones in
    const later = project({ ...doc, baseline: 2, baselines: [...baselines, { n: 2, added: ['B-003'], reqAdded: ['R-002'] }] });
    expect(later.blocks.some((b) => b.afterBaseline)).toBe(false);
    expect(later.reqsAfterBaseline).toBe(0);
  });

  it('marks nothing while baseline 1 is the only entry and has no closedAt', () => {
    const blocks = { 'B-001': docBlock({ title: 'a', phase: 'implement' }), 'B-002': docBlock({ title: 'b', phase: 'implement' }) };
    const open = [{ n: 1, added: ['B-001'], reqAdded: [] }];
    const v = project(docPlan(blocks, { baselines: open, requirements: { 'R-001': { title: 'a' } } }));
    expect(v.blocks.some((b) => b.afterBaseline)).toBe(false);
    expect(v.reqsAfterBaseline).toBe(0);
    expect(baselineText(v)).toBe('baseline 1');
    // closed, or followed by a second entry, it marks as usual
    expect(project(docPlan(blocks, { baselines: [{ ...open[0]!, closedAt: 't' }] })).blocks.map((b) => b.afterBaseline)).toEqual([undefined, true]);
    const two = [...open, { n: 2, added: [], reqAdded: [] }];
    expect(project(docPlan(blocks, { baseline: 2, baselines: two })).blocks.map((b) => b.afterBaseline)).toEqual([undefined, true]);
  });

  it('exposes the latest baseline entry with how it was confirmed', () => {
    const blocks = { 'B-001': docBlock({ title: 'a', phase: 'implement' }) };
    const base = { n: 1, added: ['B-001'], reqAdded: [], closedAt: 't' };
    expect(project(docPlan(blocks, { baselines: [base] })).latestBaseline).toEqual({ n: 1 });
    const v = project(docPlan(blocks, { baseline: 2, baselines: [base, { n: 2, added: [], reqAdded: [], via: 'mod', ticket: 'abc' }] }));
    expect(v.latestBaseline).toEqual({ n: 2, via: 'mod', ticket: 'abc' });
    expect(project(docPlan(blocks, { baseline: 0, baselines: [] })).latestBaseline).toBeUndefined();
  });

  it('marks nothing without a baseline or without a baselines array', () => {
    const blocks = { 'B-001': docBlock({ title: 'a', phase: 'implement' }) };
    for (const doc of [docPlan(blocks, { baseline: 0, baselines: [] }), docPlan(blocks)]) {
      const v = project(doc);
      expect('afterBaseline' in v.blocks[0]!).toBe(false);
      expect(v.reqsAfterBaseline).toBe(0);
    }
    expect(project(loadExamplePlan('web-waitlist')).blocks.some((b) => b.afterBaseline)).toBe(false);
  });

  it('waitingOn lists the unfinished dependencies of a blocked block only', () => {
    const v = project(docPlan({
      'B-001': docBlock({ title: 'a', phase: 'implement', status: 'done' }),
      'B-002': docBlock({ title: 'b', phase: 'implement', status: 'needs_rework', statusReason: 'r' }),
      'B-003': docBlock({ title: 'c', phase: 'implement', retired: retiredMark }),
      'B-004': docBlock({ title: 'd', phase: 'validate', status: 'blocked', statusReason: 'w', dependsOn: ['B-003', 'B-002', 'B-001'] }),
      'B-005': docBlock({ title: 'e', phase: 'validate', status: 'blocked', statusReason: 'w', dependsOn: ['B-001'] }),
      'B-006': docBlock({ title: 'f', phase: 'validate', dependsOn: ['B-002'] }),
    }));
    const by = (id: string) => v.blocks.find((b) => b.id === id)!;
    expect(by('B-004').waitingOn).toEqual(['B-002']);
    expect('waitingOn' in by('B-005')).toBe(false);
    expect('waitingOn' in by('B-006')).toBe(false);
  });

  it('openBehind lists earlier phases with unfinished active blocks, from validate onward', () => {
    const blocks = {
      'B-001': docBlock({ title: 'a', phase: 'route', status: 'done' }),
      'B-002': docBlock({ title: 'b', phase: 'implement', status: 'needs_rework', statusReason: 'r' }),
      'B-003': docBlock({ title: 'c', phase: 'validate', status: 'blocked', statusReason: 'w', dependsOn: ['B-002'] }),
      'B-004': docBlock({ title: 'd', phase: 'discover', retired: retiredMark }),
    };
    expect(project(docPlan(blocks, { currentPhase: 'validate' })).openBehind).toEqual(['implement']);
    expect(project(docPlan(blocks, { currentPhase: 'evolve' })).openBehind).toEqual(['implement', 'validate']);
    expect(project(docPlan(blocks, { currentPhase: 'implement' })).openBehind).toEqual([]);
    expect(project(docPlan({ ...blocks, 'B-002': docBlock({ title: 'b', phase: 'implement', status: 'done' }) }, { currentPhase: 'validate' })).openBehind).toEqual([]);
  });

  it('openBehind never lists discover or route, even with unfinished bookkeeping blocks there', () => {
    const blocks = {
      'B-001': docBlock({ title: 'a', phase: 'discover' }),
      'B-002': docBlock({ title: 'b', phase: 'route', status: 'in_progress', owner: 'a' }),
      'B-003': docBlock({ title: 'c', phase: 'implement', status: 'done' }),
    };
    for (const currentPhase of ['validate', 'evolve', 'release'] as const)
      expect(project(docPlan(blocks, { currentPhase })).openBehind).toEqual([]);
  });

  it('summarize adds rework and resumable without touching ready', () => {
    const doc = docPlan(
      {
        'B-001': docBlock({ title: 'a', phase: 'implement', status: 'done' }),
        'B-002': docBlock({ title: 'b', phase: 'implement', status: 'needs_rework', statusReason: 'r' }),
        'B-003': docBlock({ title: 'c', phase: 'validate', status: 'needs_rework', statusReason: 'r' }), // later phase
        'B-004': docBlock({ title: 'd', phase: 'implement', status: 'needs_rework', statusReason: 'r', retired: retiredMark }),
        'B-005': docBlock({ title: 'e', phase: 'implement', status: 'blocked', statusReason: 'w', dependsOn: ['B-001', 'B-004'] }), // resumable
        'B-006': docBlock({ title: 'f', phase: 'implement', status: 'blocked', statusReason: 'w', dependsOn: ['B-002'] }), // still waiting
        'B-007': docBlock({ title: 'g', phase: 'implement', status: 'blocked', statusReason: 'credential' }), // no dependency
        'B-008': docBlock({ title: 'h', phase: 'implement' }),
      },
      { currentPhase: 'implement' },
    );
    const s = summarize(project(doc));
    expect(s.rework).toEqual(['B-002']);
    expect(s.resumable).toEqual(['B-005']);
    expect(s.ready).toEqual(['B-008']);
  });

  it('a block held by the user and by rework is not resumable until the reason is a plain wait', () => {
    const byId = new Map([['B-004', { status: 'done' as const }]]);
    const held = { status: 'blocked' as const, deps: ['B-004'] };
    expect(isResumable({ ...held, reason: 'needs user: approve the four guides; also waiting on B-004' }, byId)).toBe(false);
    expect(isResumable({ ...held, reason: 'waiting on B-004' }, byId)).toBe(true);
  });
});

describe('baselineText and sinceBaseline', () => {
  it('count blocks and requirements that entered after the baseline, and say nothing when there are none', () => {
    const plain = project(loopedDoc());
    expect(sinceBaseline(plain)).toEqual({ blocks: 1, reqs: 0 });
    expect(baselineText(plain)).toBe('baseline 1 · +1 since');
    const none = project({ ...loopedDoc(), baselines: [{ n: 1, added: ['B-003', 'B-004', 'B-006', 'B-009'], reqAdded: [], closedAt: 't' }] });
    expect(sinceBaseline(none)).toEqual({ blocks: 0, reqs: 0 });
    expect(baselineText(none)).toBe('baseline 1');
    expect(baselineText(project({ ...loopedDoc(), baseline: 0, baselines: [] }))).toBe('baseline 0');
  });
});
