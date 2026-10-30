import { describe, expect, it } from 'vitest';
import { CG, COLLAPSED_H, HBAND, LEG_ROW, LP, MAXR, MINW, NW, layout, legendRows, type Layout, type LayoutOpts } from '../src/shared/layout.js';
import { PHASES } from '../src/shared/phases.js';
import { project } from '../src/shared/view.js';
import { loadExamplePlan, shuffleKeys } from './helpers.js';
import { docBlock, docPlan, generatedPlan } from './shared-helpers.js';

const OPTS: LayoutOpts = { bodyColumns: 100, focus: 'auto', collapseDone: false, showRetired: false };

function overlaps(l: Layout): string[] {
  const bad: string[] = [];
  for (let i = 0; i < l.nodes.length; i++)
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i]!;
      const b = l.nodes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`${a.id}/${b.id}`);
    }
  return bad;
}

describe('layout', () => {
  const plans = {
    'web-waitlist': () => loadExamplePlan('web-waitlist') as never,
    generated: () => generatedPlan(60),
  };

  it.each(Object.keys(plans) as (keyof typeof plans)[])('is deterministic under key and array shuffles (%s)', (name) => {
    const doc = plans[name]();
    for (const focus of ['auto', 'all'] as const) {
      const o = { ...OPTS, focus };
      const a = layout(project(doc), o);
      const b = layout(project(shuffleKeys(doc, true)), o);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it.each(Object.keys(plans) as (keyof typeof plans)[])('never overlaps nodes and keeps forward edges moving right (%s)', (name) => {
    const view = project(plans[name]());
    for (const o of [OPTS, { ...OPTS, focus: 'all' as const }, { ...OPTS, collapseDone: true }]) {
      const l = layout(view, o);
      expect(overlaps(l)).toEqual([]);
      for (const e of l.edges.filter((x) => x.kind === 'forward')) expect(e.x2).toBeGreaterThan(e.x1);
      for (const e of l.edges.filter((x) => x.kind === 'stub')) expect(e.x2).toBeGreaterThan(e.x1);
      for (const n of l.nodes) {
        expect(n.x + n.w).toBeLessThanOrEqual(l.width);
        expect(n.y + n.h).toBeLessThanOrEqual(l.bodyBottom);
      }
      expect(Number.isInteger(l.width) && Number.isInteger(l.height)).toBe(true);
    }
  });

  it('wraps a depth group of more than 12 nodes into several physical columns', () => {
    const blocks = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`B-${String(i + 1).padStart(3, '0')}`, docBlock({ title: `t${i}`, phase: 'implement' })]),
    );
    const l = layout(project(docPlan(blocks)), OPTS);
    const lane = l.lanes.find((x) => x.phase === 'implement')!;
    expect(lane.cols).toBe(Math.ceil(30 / MAXR));
    expect(lane.w).toBe(2 * LP + 3 * NW + 2 * CG);
    expect(new Set(l.nodes.map((n) => n.col))).toEqual(new Set([0, 1, 2]));
    expect(Math.max(...l.nodes.map((n) => n.slot))).toBe(MAXR - 1);
    expect(overlaps(l)).toEqual([]);
    const exactly12 = Object.fromEntries(Object.entries(blocks).slice(0, 12));
    expect(layout(project(docPlan(exactly12)), OPTS).lanes.find((x) => x.phase === 'implement')!.cols).toBe(1);
  });

  it('collapses lanes that do not fit and ends edges into them with stubs', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const narrow = layout(view, { ...OPTS, bodyColumns: 30 });
    const current = narrow.lanes.find((x) => x.current)!;
    expect(current.phase).toBe('implement');
    expect(current.collapsed).toBe(false);
    const collapsed = narrow.lanes.filter((x) => x.collapsed);
    expect(collapsed.length).toBeGreaterThan(0);
    for (const c of collapsed) {
      expect(c.w).toBe(MINW);
      expect(narrow.nodes.some((n) => n.phase === c.phase)).toBe(false);
    }
    expect(narrow.edges.some((e) => e.kind === 'stub')).toBe(true);
    const all = layout(view, { ...OPTS, focus: 'all' });
    expect(all.lanes.filter((x) => x.collapsed).every((x) => x.total === 0)).toBe(true);
    expect(all.width).toBeGreaterThan(narrow.width);
  });

  it('expands neighbours greedily when the pane is wide enough', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const wide = layout(view, { ...OPTS, bodyColumns: 400 });
    expect(wide.lanes.filter((x) => x.total > 0).every((x) => !x.collapsed)).toBe(true);
  });

  it('a specific focus phase seeds the expansion', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const l = layout(view, { ...OPTS, bodyColumns: 30, focus: 'discover' });
    expect(l.lanes.find((x) => x.phase === 'discover')!.collapsed).toBe(false);
    expect(l.lanes.find((x) => x.phase === 'implement')!.collapsed).toBe(true);
  });

  it('collapseDone replaces done blocks by one aggregate per phase, except the selected one', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const doneImpl = view.blocks.filter((b) => b.phase === 'implement' && b.status === 'done').map((b) => b.id);
    expect(doneImpl.length).toBeGreaterThan(0);
    const l = layout(view, { ...OPTS, focus: 'all', collapseDone: true });
    const agg = l.nodes.find((n) => n.id === 'done:implement')!;
    expect(agg.kind).toBe('agg');
    expect(agg.count).toBe(doneImpl.length);
    expect(l.nodes.filter((n) => n.kind === 'block' && n.block!.status === 'done')).toEqual([]);
    expect(l.nodes.filter((n) => n.kind === 'agg').length).toBe(PHASES.filter((p) => view.blocks.some((b) => b.phase === p && b.status === 'done')).length);
    expect(l.edges.some((e) => e.from === 'done:implement')).toBe(true);
    const gen = project(generatedPlan(60, ['done', 'in_progress']));
    const doneIds = gen.blocks.filter((b) => b.phase === 'implement' && b.status === 'done').map((b) => b.id);
    expect(doneIds.length).toBeGreaterThan(1);
    const plain = layout(gen, { ...OPTS, focus: 'all', collapseDone: true });
    const kept = layout(gen, { ...OPTS, focus: 'all', collapseDone: true, selected: doneIds[0] });
    expect(plain.nodes.some((n) => n.id === doneIds[0])).toBe(false);
    expect(kept.nodes.some((n) => n.id === doneIds[0])).toBe(true);
    expect(kept.nodes.find((n) => n.id === 'done:implement')!.count).toBe(doneIds.length - 1);
    expect(kept.edges.some((e) => e.selected)).toBe(true);
  });

  it('hides retired blocks unless asked, and drops a dependency cycle edge instead of looping', () => {
    const doc = docPlan({
      'B-001': docBlock({ title: 'a', phase: 'implement', dependsOn: ['B-002'] }),
      'B-002': docBlock({ title: 'b', phase: 'implement', dependsOn: ['B-001'] }),
      'B-003': docBlock({ title: 'gone', phase: 'implement', retired: { at: 'x', decision: 'D-001', reason: 'r' } }),
    });
    const view = project(doc);
    expect(layout(view, OPTS).nodes.map((n) => n.id).sort()).toEqual(['B-001', 'B-002']);
    expect(layout(view, { ...OPTS, showRetired: true }).nodes.length).toBe(3);
    const l = layout(view, OPTS);
    expect(l.edges.filter((e) => e.kind === 'backward').length).toBe(1);
    expect(l.edges.filter((e) => e.kind === 'forward').length).toBe(1);
    expect(overlaps(l)).toEqual([]);
  });

  it('marks the gate in the gap before route and release', () => {
    const l = layout(project(loadExamplePlan('web-waitlist') as never), OPTS);
    expect(l.gates.map((g) => g.gate)).toEqual(['route', 'release']);
    expect(l.gates[0]!.approved).toBe(true);
    const routeLane = l.lanes[1]!;
    expect(l.gates[0]!.x).toBeLessThan(routeLane.x);
    expect(l.gates[0]!.x).toBeGreaterThan(l.lanes[0]!.x + l.lanes[0]!.w);
  });
});

describe('vertical', () => {
  const VOPTS: LayoutOpts = { bodyColumns: 72, widthPx: 568, orientation: 'vertical', focus: 'auto', collapseDone: false, showRetired: false };
  const plans = {
    'web-waitlist': () => loadExamplePlan('web-waitlist') as never,
    generated: () => generatedPlan(60),
  };
  const names = Object.keys(plans) as (keyof typeof plans)[];
  const variants: [string, LayoutOpts][] = [
    ['auto', VOPTS],
    ['all', { ...VOPTS, focus: 'all' }],
    ['collapseDone', { ...VOPTS, collapseDone: true }],
    ['showRetired', { ...VOPTS, showRetired: true }],
  ];

  it.each(names)('is deterministic under key and array shuffles (%s)', (name) => {
    const doc = plans[name]();
    for (const focus of ['auto', 'all'] as const) {
      const o = { ...VOPTS, focus };
      const a = layout(project(doc), o);
      const b = layout(project(shuffleKeys(doc, true)), o);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it.each(names)('stacks ordered, non-overlapping bands holding non-overlapping nodes (%s)', (name) => {
    const view = project(plans[name]());
    for (const [, o] of variants) {
      const l = layout(view, o);
      expect(l.orientation).toBe('vertical');
      expect(l.width).toBe(568);
      expect(l.lanes.map((x) => x.phase)).toEqual([...PHASES]);
      for (const b of l.lanes) {
        expect(typeof b.y).toBe('number');
        expect(typeof b.h).toBe('number');
      }
      for (let i = 1; i < l.lanes.length; i++) expect(l.lanes[i]!.y!).toBeGreaterThanOrEqual(l.lanes[i - 1]!.y! + l.lanes[i - 1]!.h!);
      expect(overlaps(l)).toEqual([]);
      for (const n of l.nodes) {
        const band = l.lanes.find((x) => x.phase === n.phase)!;
        expect(band.collapsed).toBe(false);
        expect(n.y).toBeGreaterThanOrEqual(band.y! + HBAND);
        expect(n.y + n.h).toBeLessThanOrEqual(band.y! + band.h!);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(l.width);
      }
      expect(Number.isInteger(l.height)).toBe(true);
      expect(l.height).toBeGreaterThan(l.bodyBottom);
      expect(l.height).toBe(l.bodyBottom + 14 + legendRows(l.width) * LEG_ROW + 12);
    }
  });

  it.each(names)('draws forward edges downwards, stubs straight, gates between bands (%s)', (name) => {
    const view = project(plans[name]());
    for (const [, o] of variants) {
      const l = layout(view, o);
      for (const e of l.edges.filter((x) => x.kind === 'forward')) expect(e.y2).toBeGreaterThan(e.y1);
      for (const e of l.edges.filter((x) => x.kind === 'stub')) expect(e.x1).toBe(e.x2);
      expect(l.gates.map((g) => g.gate)).toEqual(['route', 'release']);
      for (const g of l.gates) {
        const i = PHASES.indexOf(g.gate);
        const prev = l.lanes[i - 1]!;
        const next = l.lanes[i]!;
        expect(g.y).toBeGreaterThan(prev.y! + prev.h!);
        expect(g.y).toBeLessThan(next.y!);
      }
    }
  });

  it('loops backward edges on the right', () => {
    const view = project(
      docPlan({
        'B-001': docBlock({ title: 'a', phase: 'implement', dependsOn: ['B-002'] }),
        'B-002': docBlock({ title: 'b', phase: 'implement', dependsOn: ['B-001'] }),
      }),
    );
    const l = layout(view, VOPTS);
    const back = l.edges.filter((e) => e.kind === 'backward');
    expect(back.length).toBe(1);
    expect(back[0]!.k).toBeGreaterThan(Math.max(...l.nodes.map((n) => n.x + n.w)) - 1);
    expect(back[0]!.k).toBeLessThanOrEqual(l.width);
  });

  it('ends edges into and out of a collapsed band with vertical stubs', () => {
    const l = layout(project(loadExamplePlan('web-waitlist') as never), VOPTS);
    expect(l.lanes.find((x) => x.phase === 'discover')!.collapsed).toBe(true);
    expect(l.edges.some((e) => e.kind === 'stub')).toBe(true);
  });

  const flat = (n: number) =>
    project(docPlan(Object.fromEntries(Array.from({ length: n }, (_, i) => [`B-${String(i + 1).padStart(3, '0')}`, docBlock({ title: `t${i}`, phase: 'implement' })]))));

  it('fits two cards per row at 568px and wraps the rest', () => {
    const l = layout(flat(5), VOPTS);
    expect(new Set(l.nodes.map((n) => n.x)).size).toBe(2);
    expect(Math.max(...l.nodes.map((n) => n.slot))).toBe(2);
    expect(overlaps(l)).toEqual([]);
  });

  it('fits seven cards per row at 1592px', () => {
    const l = layout(flat(8), { ...VOPTS, bodyColumns: 200, widthPx: 1592 });
    expect(l.width).toBe(1592);
    expect(new Set(l.nodes.map((n) => n.x)).size).toBe(7);
    expect(new Set(l.nodes.map((n) => n.slot))).toEqual(new Set([0, 1]));
    expect(overlaps(l)).toEqual([]);
  });

  it('focus auto opens the current phase and its neighbours only', () => {
    const l = layout(project(loadExamplePlan('web-waitlist') as never), VOPTS);
    const open = l.lanes.filter((x) => !x.collapsed).map((x) => x.phase);
    expect(open).toEqual(['route', 'implement', 'validate']);
    for (const p of ['discover', 'evolve', 'release'] as const) expect(l.lanes.find((x) => x.phase === p)!.h).toBe(COLLAPSED_H);
  });

  it('focus all opens every non-empty phase, a named focus only that phase', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const all = layout(view, { ...VOPTS, focus: 'all' });
    expect(all.lanes.filter((x) => !x.collapsed).map((x) => x.phase)).toEqual(all.lanes.filter((x) => x.total > 0).map((x) => x.phase));
    const one = layout(view, { ...VOPTS, focus: 'discover' });
    expect(one.lanes.filter((x) => !x.collapsed).map((x) => x.phase)).toEqual(['discover']);
  });

  it('the legend wraps to two rows under 760px', () => {
    expect(legendRows(568)).toBe(2);
    expect(legendRows(1592)).toBe(1);
  });
});
