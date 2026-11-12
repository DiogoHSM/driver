import { describe, expect, it } from 'vitest';
import { blockLine, docSections, paneRows, type Row, type RowsOpts } from '../src/shared/rows.js';
import { project } from '../src/shared/view.js';
import { loadExamplePlan } from './helpers.js';
import { docBlock, docPlan, loopedDoc } from './shared-helpers.js';

const OPTS: RowsOpts = { bodyColumns: 72, rows: 40, focus: 'auto', collapseDone: false, showRetired: false };
type BlockRow = Extract<Row, { kind: 'block' }>;
const blocksOf = (rows: Row[]): BlockRow[] => rows.filter((r): r is BlockRow => r.kind === 'block');

describe('paneRows', () => {
  const view = project(loadExamplePlan('web-waitlist') as never);

  it('lists phases in order with gate lines before route and release', () => {
    const rows = paneRows(view, OPTS);
    const kinds = rows.filter((r) => r.kind === 'phase' || r.kind === 'gate').map((r) => (r.kind === 'phase' ? r.phase : `gate:${r.gate}`));
    expect(kinds).toEqual(['discover', 'gate:route', 'route', 'implement', 'validate', 'evolve', 'gate:release', 'release']);
    const impl = rows.find((r): r is Extract<Row, { kind: 'phase' }> => r.kind === 'phase' && r.phase === 'implement')!;
    expect(impl).toMatchObject({ current: true, open: true });
    expect(impl.text).toBe('▾ IMPLEMENT  1/3 done  ● current');
    const gates = rows.filter((r) => r.kind === 'gate');
    expect(gates[0]).toMatchObject({ approved: true, text: '── gate route ✓ diogo ──' });
    expect(gates[1]).toMatchObject({ approved: false, text: '── gate release · pending ──' });
  });

  it('expands the current phase and its neighbours on auto, everything on all, one phase on focus', () => {
    const ids = (o: Partial<RowsOpts>) => blocksOf(paneRows(view, { ...OPTS, ...o })).map((r) => r.id);
    expect(ids({})).toEqual(['B-002', 'B-003', 'B-004', 'B-005', 'B-006']);
    expect(ids({ focus: 'all' })).toHaveLength(8);
    expect(ids({ focus: 'discover' })).toEqual(['B-001']);
    const collapsed = paneRows(view, OPTS).find((r) => r.kind === 'phase' && r.phase === 'release')!;
    expect(collapsed).toMatchObject({ open: false, expandable: true });
  });

  it('carries glyph data, owner and unmet dependencies only', () => {
    const doc = docPlan({
      'B-001': docBlock({ title: 'First', phase: 'implement', status: 'done' }),
      'B-002': docBlock({ title: 'Second', phase: 'implement', status: 'in_progress', owner: 'agent-123456789' }),
      'B-003': docBlock({ title: 'Third', phase: 'implement', dependsOn: ['B-001', 'B-002'] }),
      'B-004': docBlock({ title: 'Fourth', phase: 'implement', dependsOn: ['B-002', 'B-003'] }),
      'B-005': docBlock({ title: 'Fifth', phase: 'implement', dependsOn: ['B-002', 'B-003', 'B-004'] }),
    });
    const rows = blocksOf(paneRows(project(doc), OPTS));
    const get = (id: string) => rows.find((r) => r.id === id)!;
    expect(blockLine(get('B-001'))).toMatch(/^✓ B-001 {2}First/);
    expect(blockLine(get('B-002'))).toMatch(/^● B-002 {2}Second {2}agent-$/);
    expect(get('B-003').unmet).toEqual(['B-002']);
    expect(blockLine(get('B-005'))).toContain('← B-002, B-003 +1');
    expect(get('B-004').depth).toBe(2);
    expect(blockLine(get('B-004'))).toMatch(/^ {4}○ B-004/);
    for (const r of rows) expect(Array.from(blockLine(r)).length).toBeLessThanOrEqual(OPTS.bodyColumns);
  });

  it('orders by local depth, then id, and caps indentation at depth 3', () => {
    const blocks: Record<string, ReturnType<typeof docBlock>> = {};
    for (let i = 1; i <= 7; i++) blocks[`B-00${i}`] = docBlock({ title: `t${i}`, phase: 'implement', dependsOn: i > 1 ? [`B-00${i - 1}`] : [] });
    blocks['B-008'] = docBlock({ title: 'late root', phase: 'implement' });
    const rows = blocksOf(paneRows(project(docPlan(blocks)), OPTS));
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual(['B-001', 'B-008', 'B-002']);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(3);
    expect(blockLine(rows[rows.length - 1]!).startsWith('      ○ B-007')).toBe(true);
  });

  it('marks retired blocks and flags blocked and high-risk ones', () => {
    const doc = docPlan({
      'B-001': docBlock({ title: 'Old', phase: 'implement', retired: { at: 'x', decision: 'D-001', reason: 'r' } }),
      'B-002': docBlock({ title: 'Stuck', phase: 'implement', status: 'blocked', statusReason: 'waiting', risk: 'high' }),
    });
    const v = project(doc);
    expect(blocksOf(paneRows(v, OPTS)).map((r) => r.id)).toEqual(['B-002']);
    const rows = blocksOf(paneRows(v, { ...OPTS, showRetired: true }));
    expect(blockLine(rows[0]!)).toContain('(retired) Old');
    expect(blockLine(rows[1]!)).toMatch(/Stuck !  ?▲$|Stuck ! ▲$/);
  });

  it('collapses done blocks into one row, and done-only phases into their header', () => {
    const rows = paneRows(view, { ...OPTS, focus: 'all', collapseDone: true });
    expect(rows.filter((r) => r.kind === 'agg').map((r) => r.text)).toEqual(['✓ 1 done']); // discover and route hold only done blocks: they fold into their headers
    expect(blocksOf(rows).some((r) => r.id === 'B-003')).toBe(false);
    expect(blocksOf(paneRows(view, { ...OPTS, focus: 'all', collapseDone: true, selected: 'B-003' })).some((r) => r.id === 'B-003')).toBe(true);
    // discover holds only a done block: with hide-done on, auto leaves it folded away
    const auto = paneRows(view, { ...OPTS, collapseDone: true });
    expect(auto.find((r) => r.kind === 'phase' && r.phase === 'discover')).toMatchObject({ open: false, expandable: true });
  });

  it('draws everything when no viewport is given', () => {
    expect(paneRows(view, { bodyColumns: 72, focus: 'all', collapseDone: false, showRetired: false }).some((r) => r.kind === 'more')).toBe(false);
  });

  describe('windowing', () => {
    const blocks: Record<string, ReturnType<typeof docBlock>> = {};
    for (let i = 1; i <= 60; i++) blocks[`B-${String(i).padStart(3, '0')}`] = docBlock({ title: `t${i}`, phase: 'implement' });
    const big = project(docPlan(blocks));
    const o: RowsOpts = { ...OPTS, rows: 24 }; // room 20

    it('returns everything when it fits', () => {
      expect(paneRows(view, { ...OPTS, rows: 30 }).some((r) => r.kind === 'more')).toBe(false);
    });

    it('windows around the selection with up and down markers', () => {
      const rows = paneRows(big, { ...o, selected: 'B-030' });
      expect(rows).toHaveLength(20);
      const first = rows[0] as Extract<Row, { kind: 'more' }>;
      const last = rows[19] as Extract<Row, { kind: 'more' }>;
      expect(first).toMatchObject({ kind: 'more' });
      expect(first.text).toMatch(/^↑ \d+ more$/);
      expect(last.text).toMatch(/^↓ \d+ more$/);
      expect(blocksOf(rows).some((r) => r.id === 'B-030')).toBe(true);
      const up = Number(/\d+/.exec(first.text)![0]);
      const down = Number(/\d+/.exec(last.text)![0]);
      expect(up + down + 18).toBe(paneRows(big, { ...o, rows: 1000 }).length);
    });

    it('has no up marker at the top and no down marker at the bottom', () => {
      const top = paneRows(big, { ...o, selected: 'B-001' });
      expect(top).toHaveLength(20);
      expect(top[0]!.kind).not.toBe('more');
      expect(top[19]).toMatchObject({ kind: 'more' });
      const bottom = paneRows(big, { ...o, selected: 'B-060' });
      expect(bottom).toHaveLength(20);
      expect(bottom[0]).toMatchObject({ kind: 'more' });
      expect(bottom[19]).toMatchObject({ kind: 'phase', phase: 'release' });
      expect(blocksOf(bottom).some((r) => r.id === 'B-060')).toBe(true);
    });
  });
});

describe('docSections', () => {
  it('drops front matter, the repeated title and empty headings', () => {
    const doc = '---\nid: B-004\ntitle: "Signup API"\n---\n\n# B-004 Signup API\n\n## Spec\n\n## Notes\nSome note.\n\n## Handoff\n';
    expect(docSections(doc)).toEqual(['## Notes\n\nSome note.']);
    expect(docSections('---\nid: B-001\n---\n\n# B-001 X\n\n## Spec\n')).toEqual([]);
  });
});

describe('after the baseline and the loop', () => {
  const view = project(loopedDoc());
  const rows = paneRows(view, { ...OPTS, focus: 'all' });
  const phase = (p: string) => rows.find((r): r is Extract<Row, { kind: 'phase' }> => r.kind === 'phase' && r.phase === p)!;

  it('marks the reopened phase and keeps it open on auto focus', () => {
    expect(phase('implement')).toMatchObject({ current: false, reopened: true, text: '▾ IMPLEMENT  1/3 done  ↺ reopened' });
    expect(phase('validate')).toMatchObject({ current: true, reopened: false, text: '▾ VALIDATE  0/1 done  ● current' });
    const far = project({ ...loopedDoc(), currentPhase: 'evolve' });
    const auto = paneRows(far, { ...OPTS, focus: 'auto' });
    expect(auto.find((r) => r.kind === 'phase' && r.phase === 'implement')).toMatchObject({ open: true, reopened: true });
  });

  it('puts a + on the block that entered after the baseline and nowhere else', () => {
    const by = Object.fromEntries(blocksOf(rows).map((r) => [r.id, r]));
    expect(by['B-009']!.afterBaseline).toBe(true);
    expect(blockLine(by['B-009']!).endsWith(' +')).toBe(true);
    expect(by['B-003']!.afterBaseline).toBeUndefined();
    expect(blockLine(by['B-003']!)).not.toContain(' +');
    expect(blockLine(by['B-004']!)).toContain(' !');
  });

  it('carries what a blocked block waits on', () => {
    expect(blocksOf(rows).find((r) => r.id === 'B-006')!.waitingOn).toEqual(['B-004']);
  });
});
