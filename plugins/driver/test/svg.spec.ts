import { describe, expect, it } from 'vitest';
import { layout, type LayoutOpts } from '../src/shared/layout.js';
import { renderSvgWithinBudget, svgAlt, toSvg, toSvgVertical } from '../src/shared/svg.js';
import { project } from '../src/shared/view.js';
import { loadExamplePlan } from './helpers.js';
import { docBlock, docPlan, generatedPlan } from './shared-helpers.js';

const OPTS: LayoutOpts = { bodyColumns: 100, focus: 'auto', collapseDone: false, showRetired: false };

describe('toSvg', () => {
  const view = project(loadExamplePlan('web-waitlist') as never);

  it('matches the golden SVG for the web-waitlist example', () => {
    expect(toSvg(layout(view, OPTS), view, { tooltips: 'full' })).toMatchSnapshot();
  });

  it('draws what the design says', () => {
    const s = toSvg(layout(view, OPTS), view, { tooltips: 'full', selected: 'B-004' });
    expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ')).toBe(true);
    expect(s.match(/<style>/g)?.length).toBe(1);
    expect(s).not.toContain('style="');
    expect(s).not.toMatch(/width="[^"]*"[^>]*viewBox/);
    for (const g of ['○', '●', '■', '◐', '✓', '↺']) expect(s).toContain(g);
    expect(s).toContain('rx="6"');
    expect(s).toContain('gate route · diogo');
    expect(s).toContain('gate release · pending');
    expect(s).toContain('IMPLEMENT');
    expect(s).toContain('hc'); // current phase header
    expect(s).toContain('<title>B-004 Signup API');
    expect(s).toContain('class="n s-in_review sel"');
    expect(s).not.toMatch(/\d\.\d{3,}/); // integer-ish coordinates
    expect(toSvg(layout(view, OPTS), view, { tooltips: 'none' })).not.toContain('<title>');
    expect(toSvg(layout(view, OPTS), view, { tooltips: 'short' })).not.toContain('requirements:');
  });

  it('cuts titles at 25 characters, marks owners, risk, blocked and retired blocks', () => {
    const doc = docPlan({
      'B-001': docBlock({ title: 'A very long block title that must be cut', phase: 'implement', status: 'blocked', statusReason: 'waiting', owner: 'agent-123456789', risk: 'high' }),
      'B-002': docBlock({ title: 'Old', phase: 'implement', retired: { at: 'x', decision: 'D-001', reason: 'r' } }),
    });
    const v = project(doc);
    const s = toSvg(layout(v, { ...OPTS, showRetired: true }), v, { tooltips: 'full' });
    expect(s).toContain('A very long block title …');
    expect(s).toContain('>agent-<');
    expect(s).toContain('class="bg"');
    expect(s).toContain('▲');
    expect(s).toContain('n s-not_started ret');
    expect(s).toContain('reason: waiting');
  });

  it('escapes XML in titles and tooltips', () => {
    const nasty = `<"&'> </title><script>`;
    const v = project(docPlan({ 'B-001': docBlock({ title: nasty, phase: 'implement', statusReason: nasty, status: 'blocked' }) }));
    const s = toSvg(layout(v, OPTS), v, { tooltips: 'full' });
    expect(s).not.toContain('<script>');
    expect(s).not.toContain('</title><script');
    expect(s).toContain('&lt;&quot;&amp;&#39;&gt;');
    expect(s.replace(/<\/?(svg|style|g|title|text|rect|path)\b[^>]*>/g, '')).not.toMatch(/[<>]/);
  });

  it('renders collapsed lanes with a status bar and the aggregate node', () => {
    const l = layout(view, { ...OPTS, bodyColumns: 30, collapseDone: true });
    const s = toSvg(l, view, { tooltips: 'short' });
    expect(s).toContain('✓ ');
    expect(s).toContain('done</text>');
  });
});

describe('toSvgVertical', () => {
  const view = project(loadExamplePlan('web-waitlist') as never);
  const V: LayoutOpts = { bodyColumns: 72, widthPx: 568, orientation: 'vertical', focus: 'auto', collapseDone: false, showRetired: false };
  const draw = (o: LayoutOpts = V) => toSvgVertical(layout(view, o), view, { tooltips: 'full', selected: 'B-004' });

  it('matches the golden SVG for the web-waitlist example', () => {
    expect(toSvg(layout(view, V), view, { tooltips: 'full', selected: 'B-004' })).toMatchSnapshot();
  });

  it('toSvg dispatches to the vertical drawing', () => {
    expect(toSvg(layout(view, V), view, { tooltips: 'full', selected: 'B-004' })).toBe(draw());
  });

  it('draws what the design says', () => {
    const s = draw();
    expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568 ')).toBe(true);
    expect(s).not.toMatch(/width="[^"]*"[^>]*viewBox/);
    expect(s.match(/<style>/g)?.length).toBe(1);
    expect(s).not.toContain('style="');
    expect(s).toContain('font:13px');
    expect(s).toContain('rect class="c"');
    expect(s).toContain('.n:hover rect.c');
    expect(s).toContain('class="n s-in_review sel"');
    expect(s).toContain('<title>B-004 Signup API');
    expect(s).toContain('✓ gate route · diogo');
    expect(s).toContain('gate release · pending');
    expect(s).toContain('● current');
    expect(s).toContain('✓ 1'); // collapsed discover band: its count
    expect(s).not.toMatch(/\d\.\d{3,}/); // integer-ish coordinates
  });

  it('keeps every text and rect inside the width', () => {
    const s = draw();
    const xs = [...s.matchAll(/<(?:text|rect)\b[^>]*?\sx="(-?\d+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(20);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(568);
    }
  });

  it('escapes XML: no raw angle brackets outside tags', () => {
    const nasty = `<"&'> </title><script>`;
    const v = project(docPlan({ 'B-001': docBlock({ title: nasty, phase: 'implement', statusReason: nasty, status: 'blocked' }) }));
    const s = toSvgVertical(layout(v, V), v, { tooltips: 'full' });
    expect(s).not.toContain('<script>');
    expect(s).toContain('&lt;&quot;&amp;&#39;&gt;');
    expect(s.replace(/<\/?(svg|style|g|title|text|rect|path)\b[^>]*>/g, '')).not.toMatch(/[<>]/);
  });
});

describe('renderSvgWithinBudget (vertical)', () => {
  const V: LayoutOpts = { bodyColumns: 72, widthPx: 568, orientation: 'vertical', focus: 'auto', collapseDone: false, showRetired: false };

  it('reports width, height and the drawn block ids', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const r = renderSvgWithinBudget(view, V);
    expect(r.width).toBe(568);
    expect(Number.isInteger(r.height)).toBe(true);
    expect(r.degraded).toBe('none');
    expect(r.blockIds).toEqual(layout(view, V).nodes.filter((n) => n.kind === 'block').map((n) => n.id));
    expect(r.blockIds).toContain('B-004');
    expect(r.blockIds).toContain('B-003'); // done, drawn
    const folded = renderSvgWithinBudget(view, { ...V, collapseDone: true });
    expect(folded.blockIds).not.toContain('B-003');
    expect(folded.blockIds).toContain('B-004');
    expect(folded.blockIds).toEqual(layout(view, { ...V, collapseDone: true }).nodes.filter((n) => n.kind === 'block').map((n) => n.id));
  });

  it('keeps a 200-block plan under the budget at focus all', () => {
    const view = project(generatedPlan(200));
    const r = renderSvgWithinBudget(view, { ...V, focus: 'all' });
    expect(r.source.length).toBeLessThan(131072);
    expect(['collapsed', 'none']).toContain(r.degraded);
  });
});

describe('svgAlt', () => {
  it('summarises phase, gates, counts, ready, in progress and blocked', () => {
    const alt = svgAlt(project(loadExamplePlan('web-waitlist') as never));
    expect(alt).toContain('DRIVER plan web-waitlist');
    expect(alt).toContain('phase implement');
    expect(alt).toContain('route approved by diogo');
    expect(alt).toContain('release pending');
    expect(alt).toMatch(/\d+ done/);
  });
});

describe('renderSvgWithinBudget', () => {
  it('leaves a small plan alone', () => {
    const view = project(loadExamplePlan('web-waitlist') as never);
    const r = renderSvgWithinBudget(view, OPTS);
    expect(r.degraded).toBe('none');
    expect(r.source.length).toBeLessThan(120000);
    expect(r.alt).toContain('web-waitlist');
  });

  it('keeps 200 blocks under 120k through the ladder and reports it', () => {
    const view = project(generatedPlan(200));
    const full = toSvg(layout(view, { ...OPTS, focus: 'all' }), view, { tooltips: 'full' });
    expect(full.length).toBeGreaterThan(120000);
    const r = renderSvgWithinBudget(view, { ...OPTS, focus: 'all' });
    expect(r.degraded).not.toBe('none');
    expect(r.degraded).not.toBe('too-large');
    expect(r.source.length).toBeLessThanOrEqual(120000);
  });

  it('collapsing done blocks is the first rung', () => {
    const doc = generatedPlan(260, ['done', 'done', 'done', 'not_started']);
    expect(toSvg(layout(project(doc), { ...OPTS, focus: 'all' }), project(doc), { tooltips: 'full' }).length).toBeGreaterThan(120000);
    const r = renderSvgWithinBudget(project(doc), { ...OPTS, focus: 'all' });
    expect(r.degraded).toBe('collapsed');
    expect(r.source).toContain('✓ ');
  });

  it('gives up with too-large when even the last rung does not fit', () => {
    const r = renderSvgWithinBudget(project(generatedPlan(200)), { ...OPTS, focus: 'all' }, 5000);
    expect(r.degraded).toBe('too-large');
  });
});

describe('control characters in titles', () => {
  it('are dropped, so the SVG stays valid XML and the row text clean', () => {
    const plan = docPlan({ 'B-001': docBlock({ title: 'bad\u0000\u0007title\u001b[31m', phase: 'implement' }) });
    const view = project(plan);
    const s = toSvg(layout(view, OPTS), view, { tooltips: 'full' });
    // eslint-disable-next-line no-control-regex
    expect(s).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(s).toContain('badtitle');
  });
});
