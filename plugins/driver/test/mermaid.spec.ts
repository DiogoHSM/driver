import { describe, expect, it } from 'vitest';
import { toMermaid } from '../src/mermaid.js';
import { clonePlan } from './helpers.js';

describe('toMermaid', () => {
  it('renders phases, nodes, edges and status classes', () => {
    const out = toMermaid(clonePlan());
    expect(out.startsWith('flowchart LR\n')).toBe(true);
    const order = ['discover', 'route', 'implement', 'validate', 'evolve', 'release'].map((p) => out.indexOf(`subgraph ${p}[`));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain('subgraph implement["Implement"]');
    expect(out).toContain('    B-003["B-003 Waitlist table and signup form"]');
    expect(out).toContain('  B-002 --> B-003');
    expect(out).toContain('  B-003 --> B-005');
    expect(out).toContain('  class B-001,B-002 done');
    expect(out).toContain('  class B-003 in_review');
    expect(out).toContain('  class B-004 blocked');
    expect(out).toContain('  class B-005,B-006,B-007 not_started');
    for (const s of ['not_started', 'in_progress', 'blocked', 'in_review', 'done', 'needs_rework'])
      expect(out).toContain(`classDef ${s} fill:`);
  });

  it('skips phases without active blocks and omits retired blocks and their edges', () => {
    const p = clonePlan();
    p.blocks['B-007']!.retired = { at: '2026-10-28T10:00:00Z', decision: 'D-001', reason: 'x' };
    p.blocks['B-006']!.retired = { at: '2026-10-28T10:00:00Z', decision: 'D-001', reason: 'x' };
    const out = toMermaid(p);
    expect(out).not.toContain('subgraph evolve');
    expect(out).not.toContain('subgraph release');
    expect(out).not.toContain('B-007');
    expect(out).not.toContain('B-006');
    expect(out).not.toMatch(/B-005 --> B-006/);
  });

  it('escapes quotes and flattens whitespace in titles', () => {
    const p = clonePlan();
    p.blocks['B-001']!.title = 'Say "hi"\nthere';
    expect(toMermaid(p)).toContain('B-001["B-001 Say #quot;hi#quot; there"]');
  });

  it('escapes every Mermaid-significant character with entity codes', () => {
    const p = clonePlan();
    p.blocks['B-001']!.title = '`md` <b>x</b> [a] #1 "q"';
    expect(toMermaid(p)).toContain('B-001["B-001 #96;md#96; #lt;b#gt;x#lt;/b#gt; #91;a#93; #35;1 #quot;q#quot;"]');
  });

  it('is deterministic', () => {
    expect(toMermaid(clonePlan())).toBe(toMermaid(clonePlan()));
  });

  it('renders an empty plan', () => {
    const p = clonePlan('minimal-discover');
    p.blocks = {};
    expect(toMermaid(p)).not.toContain('subgraph');
  });
});
