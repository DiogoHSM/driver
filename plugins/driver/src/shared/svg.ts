import { layout, LEG_ROW, LP, M, NH, NW, RGV, type Layout, type LayoutEdge, type LayoutNode, type LayoutOpts } from './layout.js';
import {
  ACCENT, EDGE_BACK, EDGE_DONE, EDGE_PENDING, GATE_OK, GATE_PENDING, LANE_BG, STATUS_COLORS, TEXT_DARK, TEXT_MUTED,
} from './palette.js';
import { BLOCK_STATUSES, STATUS_GLYPH, STATUS_LABEL, type BlockStatus } from './phases.js';
import { summarize, type BlockView, type PlanView } from './view.js';

export type Tooltips = 'full' | 'short' | 'none';

const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

export const esc = (s: string): string =>
  s.replace(CONTROL, '').replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));

const cut = (s: string, n: number): string => {
  const flat = s.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : flat;
};

const ownerLabel = (o: string): string => (o === 'main' ? 'main' : o.slice(0, 6));

function css(): string {
  const st = BLOCK_STATUSES.map((s) => {
    const c = STATUS_COLORS[s];
    return `.s-${s} rect{fill:${c.fill};stroke:${c.stroke};stroke-width:${c.strokeWidth}${c.dashed ? ';stroke-dasharray:5 3' : ''}}`;
  }).join('');
  return (
    `text{font:11px ui-sans-serif,system-ui,sans-serif;fill:${TEXT_DARK}}` +
    `.l{fill:${LANE_BG};stroke:none}.lc{stroke:${ACCENT};stroke-width:1.5}.lt{opacity:.6}` +
    `.h{font-weight:600;font-size:11px;fill:${TEXT_MUTED}}.hc{font-weight:700;fill:${ACCENT}}.hn{font-size:10px;fill:${TEXT_MUTED}}` +
    st +
    `.sel rect{stroke:${ACCENT};stroke-width:3}.ret{opacity:.35}.ret .t{text-decoration:line-through}` +
    `.i{font:700 10px ui-monospace,Menlo,monospace}.g{font-size:12px;text-anchor:end}.o{font-size:9px;text-anchor:middle}` +
    `.p{fill:#fff;stroke:#6b7280;stroke-width:.5}.bg{font-weight:700;fill:#dc2626;text-anchor:end}.rk{fill:#b45309;font-size:10px;text-anchor:end}.ab{font-weight:700;fill:#1d4ed8;font-size:12px;text-anchor:end}` +
    `.e,.ed,.eb,.es{fill:none}.e{stroke:${EDGE_PENDING};stroke-width:1.5}.ed{stroke:${EDGE_DONE};stroke-width:1;opacity:.5}` +
    `.eb{stroke:${EDGE_BACK};stroke-width:1.5;stroke-dasharray:4 3}.es{stroke:${ACCENT};stroke-width:2}` +
    `.gk{stroke:${GATE_OK};stroke-width:1.5}.gp{stroke:${GATE_PENDING};stroke-width:1.5;stroke-dasharray:4 3}` +
    `.pk{fill:${GATE_OK}}.pp{fill:${GATE_PENDING}}.pt{fill:#fff;font-size:10px;font-weight:600}` +
    `.lg{font-size:10px;fill:${TEXT_MUTED}}.cn{font-size:10px;fill:${TEXT_MUTED}}.a{font-weight:600}`
  );
}

function pillWidth(text: string): number {
  return Math.round(Array.from(text).length * 5.8 + 12);
}

function tooltip(n: LayoutNode, mode: Tooltips, baseline: number): string {
  if (mode === 'none') return '';
  if (n.kind === 'agg') return `<title>${esc(`${n.count} done blocks (${n.phase})`)}</title>`;
  const b = n.block!;
  const first = `${b.id} ${b.title}`;
  if (mode === 'short') return `<title>${esc(first)}</title>`;
  const lines = [first, `${STATUS_LABEL[b.status]} since ${b.since}`];
  if (b.owner) lines.push(`owner: ${b.owner}`);
  if (b.deps.length) lines.push(`depends on: ${b.deps.join(', ')}`);
  lines.push(`requirements: ${b.reqs}; tests: ${b.tests.pass} pass, ${b.tests.fail} fail, ${b.tests.unknown} unknown`);
  if (b.verified !== undefined) lines.push(`verified: ${b.verified ? 'yes' : 'no'}`);
  if (b.reason) lines.push(`reason: ${b.reason}`);
  if (b.waitingOn?.length) lines.push(`waiting on: ${b.waitingOn.join(', ')}`);
  if (b.afterBaseline) lines.push(`added after baseline ${baseline}`);
  return `<title>${esc(lines.join('\n'))}</title>`;
}

function nodeSvg(n: LayoutNode, later: boolean, selected: string | undefined, mode: Tooltips, baseline: number): string {
  const { x, y } = n;
  if (n.kind === 'agg')
    return `<g class="n s-done${later ? ' lt' : ''}">${tooltip(n, mode, baseline)}<rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="6"/><text class="a" x="${x + 12}" y="${y + 27}">✓ ${n.count} done</text></g>`;
  const b: BlockView = n.block!;
  const cls = ['n', `s-${b.status}`, ...(b.id === selected ? ['sel'] : []), ...(b.retired ? ['ret'] : []), ...(later ? ['lt'] : [])].join(' ');
  let s = `<g class="${cls}">${tooltip(n, mode, baseline)}<rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="6"/>`;
  s += `<text class="i" x="${x + 8}" y="${y + 16}">${esc(b.id)}</text>`;
  s += `<text class="g" x="${x + NW - 8}" y="${y + 17}">${STATUS_GLYPH[b.status]}</text>`;
  if (b.owner) {
    const label = ownerLabel(b.owner);
    const pw = pillWidth(label);
    const px = x + NW - 26 - pw;
    s += `<rect class="p" x="${px}" y="${y + 6}" width="${pw}" height="12" rx="6"/><text class="o" x="${px + pw / 2}" y="${y + 15}">${esc(label)}</text>`;
  }
  s += `<text class="t" x="${x + 8}" y="${y + 34}">${esc(cut(b.title, 25))}</text>`;
  let bx = x + NW - 8;
  if (b.status === 'blocked' || b.status === 'needs_rework') {
    s += `<text class="bg" x="${bx}" y="${y + 34}">!</text>`;
    bx -= 12;
  }
  if (b.risk === 'high') {
    s += `<text class="rk" x="${bx}" y="${y + 34}">▲</text>`;
    bx -= 12;
  }
  if (b.afterBaseline) s += `<text class="ab" x="${bx}" y="${y + 34}">+</text>`;
  return `${s}</g>`;
}

function edgePath(e: LayoutEdge): string {
  const head = e.kind === 'backward' ? `M${e.x2} ${e.y2}l-3 7h6z` : `M${e.x2} ${e.y2}l-7-3v6z`;
  if (e.kind === 'forward') return `M${e.x1} ${e.y1}C${e.x1 + e.k} ${e.y1} ${e.x2 - e.k} ${e.y2} ${e.x2} ${e.y2}${head}`;
  if (e.kind === 'backward') return `M${e.x1} ${e.y1}C${e.x1} ${e.k} ${e.x2} ${e.k} ${e.x2} ${e.y2}${head}`;
  return `M${e.x1} ${e.y1}H${e.x2}`;
}

function edgeClass(e: LayoutEdge): string {
  if (e.selected) return 'es';
  if (e.kind === 'backward') return 'eb';
  return e.done ? 'ed' : 'e';
}

function legend(l: Layout): string {
  const y = l.bodyBottom + 21;
  let x = M;
  let s = '';
  for (const st of BLOCK_STATUSES) {
    const c = STATUS_COLORS[st];
    s += `<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${c.fill}" stroke="${c.stroke}"/><text class="lg" x="${x + 14}" y="${y + 9}">${STATUS_GLYPH[st]} ${STATUS_LABEL[st]}</text>`;
    x += 14 + Math.round((STATUS_LABEL[st].length + 2) * 5.6) + 12;
  }
  return `${s}<text class="lg" x="${x}" y="${y + 9}">! needs attention   ▲ high risk   + added after baseline</text>`;
}

function collapsedLane(l: Layout['lanes'][number], l0: Layout): string {
  const top = M + 38;
  const bh = Math.max(20, l0.bodyBottom - top - 8);
  let s = '';
  if (l.total === 0) return `<text class="hn" x="${l.x + LP}" y="${top + 12}">–</text>`;
  let y = top;
  let used = 0;
  const present = BLOCK_STATUSES.filter((st) => l.counts[st] > 0);
  present.forEach((st, i) => {
    const h = i === present.length - 1 ? bh - used : Math.round((l.counts[st] / l.total) * bh);
    used += h;
    const c = STATUS_COLORS[st];
    s += `<rect x="${l.x + LP}" y="${y}" width="12" height="${h}" fill="${c.fill}" stroke="${c.stroke}"/>`;
    y += h;
  });
  present.forEach((st, i) => {
    s += `<text class="cn" x="${l.x + LP + 20}" y="${top + 12 + i * 15}">${STATUS_GLYPH[st]} ${l.counts[st]}</text>`;
  });
  return s;
}

export function toSvg(l: Layout, view: PlanView, opts: { selected?: string; tooltips: Tooltips }): string {
  if (l.orientation === 'vertical') return toSvgVertical(l, view, opts);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.width} ${l.height}" role="img"><style>${css()}</style>`);

  for (const ln of l.lanes) {
    const cls = ['l', ...(ln.current || ln.reopened ? ['lc'] : []), ...(ln.later ? ['lt'] : [])].join(' ');
    parts.push(`<rect class="${cls}" x="${ln.x}" y="${M}" width="${ln.w}" height="${l.bodyBottom - M}" rx="8"/>`);
    const hc = `h${ln.current || ln.reopened ? ' hc' : ''}${ln.later ? ' lt' : ''}`;
    const name = ln.phase.toUpperCase();
    if (ln.collapsed) {
      parts.push(`<text class="${hc}" x="${ln.x + LP}" y="${M + 16}">${name}</text><text class="hn" x="${ln.x + LP}" y="${M + 29}">${ln.done}/${ln.total}${ln.reopened ? ' ↺' : ''}</text>`);
      parts.push(collapsedLane(ln, l));
    } else parts.push(`<text class="${hc}" x="${ln.x + LP}" y="${M + 22}">${name} ${ln.done}/${ln.total}${ln.reopened ? ' ↺ reopened' : ''}</text>`);
  }

  for (const g of l.gates) {
    parts.push(`<path class="${g.approved ? 'gk' : 'gp'}" d="M${g.x} ${g.y1}V${g.y2}"/>`);
    const text = g.approved ? `✓ gate ${g.gate}${g.by ? ` · ${g.by}` : ''}` : `gate ${g.gate} · pending`;
    const pw = pillWidth(text);
    const px = Math.max(M, Math.min(l.width - M - pw, Math.round(g.x - pw / 2)));
    parts.push(
      `<rect class="${g.approved ? 'pk' : 'pp'}" x="${px}" y="${l.bodyBottom + 3}" width="${pw}" height="14" rx="7"/><text class="pt" x="${px + 6}" y="${l.bodyBottom + 13}">${esc(text)}</text>`,
    );
  }

  const ordered = [...l.edges.filter((e) => !e.selected), ...l.edges.filter((e) => e.selected)];
  for (const e of ordered) parts.push(`<path class="${edgeClass(e)}" d="${edgePath(e)}"/>`);

  const later = new Map(l.lanes.map((ln) => [ln.phase, ln.later]));
  for (const n of l.nodes) parts.push(nodeSvg(n, later.get(n.phase) === true, opts.selected, opts.tooltips, view.baseline));

  parts.push(legend(l));
  parts.push('</svg>');
  return parts.join('');
}

// ---------------------------------------------------------------- vertical (the pane)

/** Approximate advance of the 13px UI font, for cutting titles and sizing pills. */
const CHAR_W = 6.8;
const pillWidthV = (text: string): number => Math.round(Array.from(text).length * 6.6 + 16);

function cssVertical(): string {
  const st = BLOCK_STATUSES.map((s) => {
    const c = STATUS_COLORS[s];
    return `.s-${s} rect.c{fill:${c.fill};stroke:${c.stroke};stroke-width:${c.strokeWidth}${c.dashed ? ';stroke-dasharray:6 4' : ''}}`;
  }).join('');
  return (
    `text{font:13px ui-sans-serif,system-ui,sans-serif;fill:${TEXT_DARK}}` +
    `.l{fill:${LANE_BG};stroke:none}.lc{stroke:${ACCENT};stroke-width:1.5}.lt{opacity:.7}` +
    `.h{font-weight:600;fill:${TEXT_MUTED}}.hc{font-weight:700;fill:${ACCENT}}.hn{font-size:12px;fill:${TEXT_MUTED}}.cur{font-size:12px;font-weight:600;fill:${ACCENT}}` +
    st +
    `.n:hover rect.c{stroke:${ACCENT};stroke-width:3}.sel rect.c{stroke:${ACCENT};stroke-width:3}.ret{opacity:.35}.ret .t{text-decoration:line-through}` +
    `.i{font:700 12px ui-monospace,Menlo,monospace}.g{font-size:15px;text-anchor:end}.o{font-size:11px;text-anchor:middle}` +
    `.p{fill:#fff;stroke:#6b7280;stroke-width:.5}.bg{font-weight:700;fill:#dc2626;text-anchor:end}.rk{fill:#b45309;font-size:12px;text-anchor:end}.ab{font-weight:700;fill:#1d4ed8;text-anchor:end}` +
    `.e,.ed,.eb,.es{fill:none}.e{stroke:${EDGE_PENDING};stroke-width:1.5}.ed{stroke:${EDGE_DONE};stroke-width:1;opacity:.5}` +
    `.eb{stroke:${EDGE_BACK};stroke-width:1.5;stroke-dasharray:4 3}.es{stroke:${ACCENT};stroke-width:2.5}` +
    `.gk{stroke:${GATE_OK};stroke-width:2}.gp{stroke:${GATE_PENDING};stroke-width:2;stroke-dasharray:6 4}` +
    `.pk{fill:${GATE_OK}}.pp{fill:${GATE_PENDING}}.pt{fill:#fff;font-size:12px;font-weight:600}` +
    `.lg{font-size:12px;fill:${TEXT_MUTED}}.cn{font-size:12px;fill:${TEXT_MUTED};text-anchor:end}.a{font-weight:600}`
  );
}

function nodeVertical(n: LayoutNode, later: boolean, selected: string | undefined, mode: Tooltips, baseline: number): string {
  const { x, y, w, h } = n;
  if (n.kind === 'agg')
    return `<g class="n s-done${later ? ' lt' : ''}">${tooltip(n, mode, baseline)}<rect class="c" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><text class="a" x="${x + 12}" y="${y + Math.round(h / 2) + 5}">✓ ${n.count} done</text></g>`;
  const b: BlockView = n.block!;
  const cls = ['n', `s-${b.status}`, ...(b.id === selected ? ['sel'] : []), ...(b.retired ? ['ret'] : []), ...(later ? ['lt'] : [])].join(' ');
  let s = `<g class="${cls}">${tooltip(n, mode, baseline)}<rect class="c" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>`;
  s += `<text class="i" x="${x + 10}" y="${y + 20}">${esc(b.id)}</text>`;
  s += `<text class="g" x="${x + w - 10}" y="${y + 21}">${STATUS_GLYPH[b.status]}</text>`;
  if (b.owner) {
    const label = ownerLabel(b.owner);
    const pw = pillWidthV(label);
    const px = x + w - 32 - pw;
    s += `<rect class="p" x="${px}" y="${y + 8}" width="${pw}" height="16" rx="8"/><text class="o" x="${px + Math.round(pw / 2)}" y="${y + 20}">${esc(label)}</text>`;
  }
  const flag = b.status === 'blocked' || b.status === 'needs_rework';
  const badges = (flag ? 1 : 0) + (b.risk === 'high' ? 1 : 0) + (b.afterBaseline ? 1 : 0);
  const maxChars = Math.max(8, Math.floor((w - 20 - badges * 16) / CHAR_W));
  s += `<text class="t" x="${x + 10}" y="${y + 42}">${esc(cut(b.title, maxChars))}</text>`;
  let bx = x + w - 10;
  if (flag) {
    s += `<text class="bg" x="${bx}" y="${y + 42}">!</text>`;
    bx -= 14;
  }
  if (b.risk === 'high') {
    s += `<text class="rk" x="${bx}" y="${y + 42}">▲</text>`;
    bx -= 14;
  }
  if (b.afterBaseline) s += `<text class="ab" x="${bx}" y="${y + 42}">+</text>`;
  return `${s}</g>`;
}

/** Forward edges run orthogonally: down from the source, along the gap just above the target's row, then into the target from above. */
function edgePathVertical(e: LayoutEdge): string {
  const head = `M${e.x2} ${e.y2}l-4 -8h8z`;
  if (e.kind === 'forward') {
    if (e.x1 === e.x2) return `M${e.x1} ${e.y1}V${e.y2}${head}`;
    const ym = e.y2 - RGV / 2;
    const dir = e.x2 > e.x1 ? 1 : -1;
    const r = Math.min(6, Math.abs(e.x2 - e.x1) / 2, Math.max(1, (ym - e.y1) / 2));
    return (
      `M${e.x1} ${e.y1}V${ym - r}Q${e.x1} ${ym} ${e.x1 + dir * r} ${ym}H${e.x2 - dir * r}Q${e.x2} ${ym} ${e.x2} ${ym + r}V${e.y2}${head}`
    );
  }
  if (e.kind === 'backward') return `M${e.x1} ${e.y1}C${e.k} ${e.y1} ${e.k} ${e.y2} ${e.x2} ${e.y2}M${e.x2} ${e.y2}l8 -4v8z`;
  return `M${e.x1} ${e.y1}V${e.y2}`;
}

function bandVertical(ln: Layout['lanes'][number]): string {
  const y = ln.y!;
  const h = ln.h!;
  const cls = ['l', ...(ln.current || ln.reopened ? ['lc'] : []), ...(ln.later ? ['lt'] : [])].join(' ');
  let s = `<rect class="${cls}" x="${ln.x}" y="${y}" width="${ln.w}" height="${h}" rx="8"/>`;
  const name = ln.phase.toUpperCase();
  const hx = ln.x + LP;
  const hy = y + 21;
  const dim = ln.later ? ' lt' : '';
  s += `<text class="h${ln.current || ln.reopened ? ' hc' : ''}${dim}" x="${hx}" y="${hy}">${name}</text>`;
  let cx = hx + Math.round(Array.from(name).length * 8.8) + 10;
  const count = ln.total === 0 ? 'no blocks' : `${ln.done}/${ln.total} done`;
  s += `<text class="hn${dim}" x="${cx}" y="${hy}">${count}</text>`;
  cx += Math.round(count.length * 6.6) + 12;
  if (ln.current) {
    s += `<text class="cur" x="${cx}" y="${hy}">● current</text>`;
    cx += Math.round('● current'.length * 6.6) + 12;
  }
  if (ln.reopened) s += `<text class="cur" x="${cx}" y="${hy}">↺ reopened</text>`;
  if (ln.collapsed && ln.total > 0) {
    const present = BLOCK_STATUSES.filter((st) => ln.counts[st] > 0);
    s += `<text class="cn${dim}" x="${ln.x + ln.w - LP}" y="${hy}">${present.map((st) => `${STATUS_GLYPH[st]} ${ln.counts[st]}`).join('  ')}</text>`;
    const bw = Math.min(240, ln.w - 2 * LP);
    let bx = hx;
    let used = 0;
    present.forEach((st, i) => {
      const seg = i === present.length - 1 ? bw - used : Math.round((ln.counts[st] / ln.total) * bw);
      used += seg;
      const c = STATUS_COLORS[st];
      s += `<rect x="${bx}" y="${y + 30}" width="${seg}" height="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width=".5"/>`;
      bx += seg;
    });
  }
  return s;
}

/** One dashed arrow on the right margin from the current band's header up to each reopened band's header. */
function loopsVertical(l: Layout): string {
  const from = l.lanes.find((ln) => ln.current);
  if (!from || from.y === undefined) return '';
  let s = '';
  l.lanes
    .filter((ln) => ln.reopened && ln.y !== undefined)
    .forEach((to, i) => {
      const right = from.x + from.w;
      const x = right - 6 - i * 5;
      const y1 = from.y! + 16;
      const y2 = to.y! + 16;
      s += `<path class="eb" d="M${right - 14} ${y1}H${x}V${y2}H${right - 12}M${right - 12} ${y2}l8 -4v8z"/>`;
    });
  return s;
}

/** Status swatches, then the marks; items wrap to a new row when the next would cross the right margin. */
function legendVertical(l: Layout): string {
  let y = l.bodyBottom + 16;
  let x = M;
  let s = '';
  const place = (w: number): void => {
    if (x > M && x + w > l.width - M) {
      x = M;
      y += LEG_ROW;
    }
  };
  for (const st of BLOCK_STATUSES) {
    const c = STATUS_COLORS[st];
    const w = 16 + Math.round((STATUS_LABEL[st].length + 2) * 6.6) + 14;
    place(w);
    s += `<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="${c.fill}" stroke="${c.stroke}"/><text class="lg" x="${x + 16}" y="${y + 10}">${STATUS_GLYPH[st]} ${STATUS_LABEL[st]}</text>`;
    x += w;
  }
  const marks = '! needs attention   ▲ high risk   + added after baseline';
  place(Math.round(marks.length * 6.6));
  return `${s}<text class="lg" x="${x}" y="${y + 10}">${marks}</text>`;
}

/** Phases as bands top to bottom at a fixed pixel width: the pane's drawing, legible at 1:1 and scrolled when tall. */
export function toSvgVertical(l: Layout, view: PlanView, opts: { selected?: string; tooltips: Tooltips }): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.width} ${l.height}" role="img"><style>${cssVertical()}</style>`);
  for (const ln of l.lanes) parts.push(bandVertical(ln));

  for (const g of l.gates) {
    const y = g.y!;
    parts.push(`<path class="${g.approved ? 'gk' : 'gp'}" d="M${M} ${y}H${l.width - M}"/>`);
    const text = g.approved ? `✓ gate ${g.gate}${g.by ? ` · ${g.by}` : ''}` : `gate ${g.gate} · pending`;
    const pw = pillWidthV(text);
    const px = Math.max(M, Math.round(l.width / 2 - pw / 2));
    parts.push(`<rect class="${g.approved ? 'pk' : 'pp'}" x="${px}" y="${y - 10}" width="${pw}" height="20" rx="10"/><text class="pt" x="${px + 8}" y="${y + 4}">${esc(text)}</text>`);
  }

  const ordered = [...l.edges.filter((e) => !e.selected), ...l.edges.filter((e) => e.selected)];
  for (const e of ordered) parts.push(`<path class="${edgeClass(e)}" d="${edgePathVertical(e)}"/>`);

  const later = new Map(l.lanes.map((ln) => [ln.phase, ln.later]));
  for (const n of l.nodes) parts.push(nodeVertical(n, later.get(n.phase) === true, opts.selected, opts.tooltips, view.baseline));
  parts.push(loopsVertical(l));

  parts.push(legendVertical(l));
  parts.push('</svg>');
  return parts.join('');
}

export function svgAlt(view: PlanView): string {
  const s = summarize(view);
  const active = view.blocks.filter((b) => !b.retired).length;
  const counts = BLOCK_STATUSES.filter((st: BlockStatus) => s.counts[st] > 0)
    .map((st) => `${s.counts[st]} ${STATUS_LABEL[st]}`)
    .join(', ');
  const gate = (g: 'route' | 'release') => {
    const v = view.gates[g];
    return v.approved ? `${g} approved${v.by ? ` by ${v.by}` : ''}` : `${g} pending`;
  };
  const parts = [
    `DRIVER plan ${view.project}, revision ${view.revision}, phase ${view.currentPhase}.`,
    `${active} active blocks${counts ? ` (${counts})` : ''}.`,
    `Gates: ${gate('route')}; ${gate('release')}.`,
  ];
  if (s.ready.length) parts.push(`Ready: ${s.ready.join(', ')}.`);
  if (s.inProgress.length) parts.push(`In progress: ${s.inProgress.map((b) => (b.owner ? `${b.id} (${b.owner})` : b.id)).join(', ')}.`);
  if (s.blocked.length) parts.push(`Blocked: ${s.blocked.map((b) => (b.reason ? `${b.id} (${cut(b.reason, 80)})` : b.id)).join(', ')}.`);
  return parts.join(' ');
}

export interface Rendered {
  source: string;
  alt: string;
  /** Natural size of the drawing in CSS pixels (the viewBox). */
  width: number;
  height: number;
  /** Ids of the blocks drawn as nodes, in drawing order (folded done blocks are not among them). */
  blockIds: string[];
  degraded: 'none' | 'collapsed' | 'short-tooltips' | 'too-large';
}

/** Fallback ladder: as asked, then done blocks collapsed, then first-line tooltips, then give up. */
export function renderSvgWithinBudget(
  view: PlanView,
  layoutOpts: LayoutOpts,
  max = 120000,
  tooltips: Tooltips = 'full',
): Rendered {
  const alt = svgAlt(view);
  const draw = (o: LayoutOpts, t: Tooltips): Omit<Rendered, 'degraded'> => {
    const l = layout(view, o);
    const blockIds = l.nodes.filter((n) => n.kind === 'block').map((n) => n.id);
    return { source: toSvg(l, view, { selected: o.selected, tooltips: t }), alt, width: l.width, height: l.height, blockIds };
  };
  let r = draw(layoutOpts, tooltips);
  if (r.source.length <= max) return { ...r, degraded: 'none' };
  const collapsed: LayoutOpts = { ...layoutOpts, collapseDone: true };
  if (!layoutOpts.collapseDone) {
    r = draw(collapsed, tooltips);
    if (r.source.length <= max) return { ...r, degraded: 'collapsed' };
  }
  if (tooltips !== 'none') {
    r = draw(collapsed, 'short');
    if (r.source.length <= max) return { ...r, degraded: 'short-tooltips' };
  }
  return { ...r, degraded: 'too-large' };
}
