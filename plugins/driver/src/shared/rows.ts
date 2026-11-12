import { PHASES, phaseIndex, STATUS_GLYPH, STATUS_LABEL, type BlockStatus, type PhaseId } from './phases.js';
import type { GateName } from './plan-doc.js';
import { compareIds, type BlockView, type PlanView } from './view.js';

export type Row =
  | { kind: 'phase'; phase: PhaseId; text: string; current: boolean; reopened: boolean; open: boolean; expandable: boolean; done: number; total: number; attention: number }
  | { kind: 'gate'; gate: GateName; text: string; approved: boolean; by?: string }
  | {
      kind: 'block';
      id: string;
      status: BlockStatus;
      depth: number;
      title: string;
      /** Title cut for a card (about two lines). */
      cardTitle: string;
      statusLabel: string;
      owner?: string;
      ownerLabel?: string;
      /** Dependencies that are not done yet, all of them. */
      unmet: string[];
      risk?: 'low' | 'medium' | 'high';
      retired: boolean;
      /** The block entered the plan after the current baseline. */
      afterBaseline?: true;
      /** For a blocked block: dependencies that are not done yet. */
      waitingOn?: string[];
    }
  | { kind: 'agg'; phase: PhaseId; count: number; text: string }
  | { kind: 'more'; text: string };

export interface RowsOpts {
  bodyColumns: number;
  /** Viewport rows; set it only where the pane does not scroll. The renderer reserves 4 for its own chrome. */
  rows?: number;
  focus: 'auto' | PhaseId | 'all';
  collapseDone: boolean;
  showRetired: boolean;
  selected?: string;
}

const MAX_DEPTH = 3;

const fit = (raw: string, n: number): string => {
  const s = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const c = Array.from(s);
  return c.length > n ? `${c.slice(0, Math.max(1, n - 1)).join('')}…` : s;
};
const ownerLabel = (o: string): string => (o === 'main' ? 'main' : o.slice(0, 6));
export const depsText = (unmet: string[]): string =>
  unmet.length ? ` ← ${unmet.slice(0, 2).join(', ')}${unmet.length > 2 ? ` +${unmet.length - 2}` : ''}` : '';

/** The text of a block row as drawn: indent, glyph, id, title, owner, pending dependencies. */
export function blockLine(r: Extract<Row, { kind: 'block' }>): string {
  const flag = (r.status === 'blocked' || r.status === 'needs_rework' ? ' !' : '') + (r.risk === 'high' ? ' ▲' : '') + (r.afterBaseline ? ' +' : '');
  return `${'  '.repeat(r.depth)}${STATUS_GLYPH[r.status]} ${r.id}  ${r.retired ? '(retired) ' : ''}${r.title}${r.owner ? `  ${ownerLabel(r.owner)}` : ''}${depsText(r.unmet)}${flag}`;
}

export function paneRows(view: PlanView, opts: RowsOpts): Row[] {
  const cols = Math.max(20, opts.bodyColumns);
  const blocks = view.blocks.filter((b) => opts.showRetired || !b.retired);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const unmetOf = (b: BlockView): string[] =>
    b.deps.filter((d) => {
      const x = byId.get(d);
      return !x || (x.status !== 'done' && !x.retired);
    });

  // depth through unmet in-phase deps, cycle safe
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    const b = byId.get(id)!;
    let d = 0;
    for (const dep of unmetOf(b)) {
      const x = byId.get(dep);
      if (!x || x.phase !== b.phase || visiting.has(dep)) continue;
      d = Math.max(d, depthOf(dep) + 1);
    }
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const cur = phaseIndex(view.currentPhase);
  const reopenedSet = new Set<PhaseId>(view.openBehind ?? []);
  const collapsible = (b: BlockView): boolean => opts.collapseDone && b.status === 'done' && !b.retired && b.id !== opts.selected;
  const wanted = (p: PhaseId): boolean => {
    if (opts.focus === 'all') return true;
    if (opts.focus !== 'auto') return opts.focus === p;
    return Math.abs(phaseIndex(p) - cur) <= 1 || reopenedSet.has(p);
  };

  const out: Row[] = [];
  let focusAt = -1;
  let currentAt = 0;
  for (const p of PHASES) {
    if (p === 'route' || p === 'release') {
      const g = view.gates[p];
      const text = g.approved ? `── gate ${p} ✓ ${g.by ?? 'approved'} ──` : `── gate ${p} · pending ──`;
      out.push({ kind: 'gate', gate: p, text: fit(text, cols), approved: g.approved, ...(g.by ? { by: g.by } : {}) });
    }
    const inPhase = blocks.filter((b) => b.phase === p);
    const done = inPhase.filter((b) => b.status === 'done').length;
    const current = p === view.currentPhase;
    const allDone = inPhase.length > 0 && inPhase.every(collapsible);
    const isOpen = inPhase.length > 0 && wanted(p) && !(allDone && opts.focus !== p);
    const attention = inPhase.filter((b) => b.status === 'blocked' || b.status === 'needs_rework').length;
    const reopened = reopenedSet.has(p);
    const tail = `${current ? '  ● current' : ''}${reopened ? '  ↺ reopened' : ''}${!isOpen && attention ? `  ! ${attention}` : ''}`;
    if (current) currentAt = out.length;
    out.push({
      kind: 'phase',
      phase: p,
      text: fit(`${isOpen ? '▾' : '▸'} ${p.toUpperCase()}  ${done}/${inPhase.length} done${tail}`, cols),
      current,
      reopened,
      open: isOpen,
      expandable: !isOpen && inPhase.length > 0,
      done,
      total: inPhase.length,
      attention,
    });
    if (!isOpen) continue;
    const nDone = inPhase.filter(collapsible).length;
    if (nDone > 0) out.push({ kind: 'agg', phase: p, count: nDone, text: `${STATUS_GLYPH.done} ${nDone} done` });
    const rest = inPhase
      .filter((b) => !collapsible(b))
      .map((b) => ({ b, d: depthOf(b.id) }))
      .sort((x, y) => x.d - y.d || compareIds(x.b.id, y.b.id));
    for (const { b, d } of rest) {
      if (b.id === opts.selected) focusAt = out.length;
      const dd = Math.min(d, MAX_DEPTH);
      const unmet = unmetOf(b);
      const row: Extract<Row, { kind: 'block' }> = {
        kind: 'block',
        id: b.id,
        status: b.status,
        depth: dd,
        title: '',
        cardTitle: fit(b.title, 60),
        statusLabel: STATUS_LABEL[b.status],
        ...(b.owner ? { owner: b.owner, ownerLabel: ownerLabel(b.owner) } : {}),
        unmet,
        ...(b.risk ? { risk: b.risk } : {}),
        retired: b.retired,
        ...(b.afterBaseline ? { afterBaseline: true as const } : {}),
        ...(b.waitingOn?.length ? { waitingOn: b.waitingOn } : {}),
      };
      const room = Math.max(8, cols - Array.from(blockLine({ ...row, title: '' })).length);
      out.push({ ...row, title: fit(b.title, room) });
    }
  }

  if (opts.rows === undefined) return out;
  const room = Math.max(4, opts.rows - 4);
  const total = out.length;
  if (total <= room) return out;
  const focus = focusAt >= 0 ? focusAt : currentAt;
  let vis = room - 2;
  let start = Math.min(Math.max(0, focus - Math.floor(vis / 2)), total - vis);
  if (start === 0) vis = room - 1;
  else if (start + vis >= total) {
    vis = room - 1;
    start = total - vis;
  }
  const end = start + vis;
  const rows: Row[] = [];
  if (start > 0) rows.push({ kind: 'more', text: `↑ ${start} more` });
  rows.push(...out.slice(start, end));
  if (end < total) rows.push({ kind: 'more', text: `↓ ${total - end} more` });
  return rows;
}

/** The sections of a block document that say something: front matter, the repeated title and empty headings are dropped. */
export function docSections(doc: string): string[] {
  let text = doc.replace(/\r\n/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end >= 0) text = text.slice(text.indexOf('\n', end + 1) + 1);
  }
  const out: string[] = [];
  let head = '';
  let body: string[] = [];
  const flush = (): void => {
    const b = body.join('\n').trim();
    if (b) out.push(head ? `${head}\n\n${b}` : b);
  };
  for (const line of text.split('\n')) {
    if (/^#{1,2}\s/.test(line)) {
      flush();
      // "# B-004 Title" repeats what the card already says
      head = /^#\s+B-\d+/.test(line) ? '' : line;
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}
