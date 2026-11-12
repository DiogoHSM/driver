import { BLOCK_STATUSES, PHASES, phaseIndex, type BlockStatus, type PhaseId } from './phases.js';
import type { GateName } from './plan-doc.js';
import { compareIds, type BlockView, type PlanView } from './view.js';

export const NW = 176;
export const NH = 44;
export const CG = 40;
export const RG = 10;
export const LP = 14;
export const LG = 28;
export const M = 12;
export const HH = 34;
export const LEG = 30;
export const MAXR = 12;
export const MINW = 92;
export const PX_PER_COL = 8;
export const STUB = 16;
/** Vertical layout: sized for 13px text, so the pane scrolls instead of shrinking. */
export const NWV = 190;
export const CGV = 16;
export const NHV = 56;
export const RGV = 14;
export const HBAND = 32;
export const COLLAPSED_H = 44;
export const BAND_GAP = 12;
export const GATE_GAP = 36;
/** Legend row height and the width under which the legend wraps to two rows. */
export const LEG_ROW = 20;
export const LEG_WRAP_W = 760;
export const legendRows = (width: number): number => (width < LEG_WRAP_W ? 2 : 1);

export interface LayoutOpts {
  bodyColumns: number;
  focus: 'auto' | PhaseId | 'all';
  collapseDone: boolean;
  showRetired: boolean;
  selected?: string;
  /** `auto` (default) goes vertical when the horizontal diagram would be scaled below 1:1. */
  orientation?: 'auto' | 'horizontal' | 'vertical';
  /** Vertical only: the drawn width in CSS pixels; absent, `bodyColumns * PX_PER_COL`. */
  widthPx?: number;
}

export interface LayoutLane {
  phase: PhaseId;
  x: number;
  w: number;
  collapsed: boolean;
  current: boolean;
  later: boolean;
  /** Earlier phase that still holds unfinished work (drawn as active, with a loop back from the current phase). */
  reopened: boolean;
  /** Physical columns (0 when collapsed or empty). */
  cols: number;
  total: number;
  done: number;
  counts: Record<BlockStatus, number>;
  /** Vertical layout only: the band's top edge and height. */
  y?: number;
  h?: number;
}

export interface LayoutNode {
  /** Block id, or `done:<phase>` for the collapsed-done aggregate. */
  id: string;
  kind: 'block' | 'agg';
  phase: PhaseId;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  slot: number;
  block?: BlockView;
  /** Aggregate only: how many done blocks it stands for. */
  count?: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  kind: 'forward' | 'backward' | 'stub';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Bezier control offset (forward) or loop depth y (backward). */
  k: number;
  done: boolean;
  selected: boolean;
}

export interface LayoutGate {
  gate: GateName;
  x: number;
  y1: number;
  y2: number;
  /** Vertical layout only: the line's y (it runs the whole width). */
  y?: number;
  approved: boolean;
  by?: string;
  at?: string;
}

export interface Layout {
  orientation: 'horizontal' | 'vertical';
  lanes: LayoutLane[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  gates: LayoutGate[];
  width: number;
  height: number;
  /** y where the lane bodies end (legend starts below). */
  bodyBottom: number;
}

const aggId = (p: PhaseId): string => `done:${p}`;

export function layout(view: PlanView, opts: LayoutOpts): Layout {
  const cur = phaseIndex(view.currentPhase);
  const reopenedSet = new Set<PhaseId>(view.openBehind ?? []);
  const blocks = view.blocks
    .filter((b) => opts.showRetired || !b.retired)
    .slice()
    .sort((a, b) => compareIds(a.id, b.id));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const inAgg = (b: BlockView): boolean => opts.collapseDone && b.status === 'done' && !b.retired && b.id !== opts.selected;
  const rep = (id: string): string => {
    const b = byId.get(id)!;
    return inAgg(b) ? aggId(b.phase) : id;
  };
  const visibleDeps = (b: BlockView): string[] => b.deps.filter((d) => byId.has(d));

  // 2. local depth per phase, cycles dropped
  const depth = new Map<string, number>();
  const state = new Map<string, 1 | 2>();
  const cyc = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    state.set(id, 1);
    let d = 0;
    const b = byId.get(id)!;
    for (const dep of visibleDeps(b)) {
      if (byId.get(dep)!.phase !== b.phase) continue;
      if (state.get(dep) === 1) {
        cyc.add(`${dep}>${id}`);
        continue;
      }
      d = Math.max(d, visit(dep) + 1);
    }
    state.set(id, 2);
    depth.set(id, d);
    return d;
  };
  for (const b of blocks) visit(b.id);

  // per phase: nodes (blocks that stay, plus the aggregate), rank = compacted depth
  interface Item {
    id: string;
    phase: PhaseId;
    depth: number;
    rank: number;
    block?: BlockView;
    count?: number;
  }
  const items = new Map<PhaseId, Item[]>();
  const ranksPerPhase = new Map<PhaseId, number[]>(); // physical columns per rank
  for (const p of PHASES) {
    const inPhase = blocks.filter((b) => b.phase === p);
    const list: Item[] = [];
    const aggCount = inPhase.filter(inAgg).length;
    if (aggCount > 0) list.push({ id: aggId(p), phase: p, depth: 0, rank: 0, count: aggCount });
    for (const b of inPhase) if (!inAgg(b)) list.push({ id: b.id, phase: p, depth: depth.get(b.id)!, rank: 0, block: b });
    const distinct = [...new Set(list.map((i) => i.depth))].sort((a, b) => a - b);
    for (const i of list) i.rank = distinct.indexOf(i.depth);
    const cols = distinct.map((_, r) => Math.max(1, Math.ceil(list.filter((i) => i.rank === r).length / MAXR)));
    items.set(p, list);
    ranksPerPhase.set(p, cols);
  }
  const S = (p: PhaseId): number => ranksPerPhase.get(p)!.reduce((a, b) => a + b, 0);
  const naturalW = (p: PhaseId): number => 2 * LP + S(p) * NW + (S(p) - 1) * CG;

  // 4. lane expansion
  const nonEmpty = PHASES.filter((p) => S(p) > 0);
  const expanded = new Set<PhaseId>();
  const canvasW = (set: Set<PhaseId>): number =>
    2 * M + (PHASES.length - 1) * LG + PHASES.reduce((a, p) => a + (set.has(p) && S(p) > 0 ? naturalW(p) : MINW), 0);
  if (opts.focus === 'all') for (const p of nonEmpty) expanded.add(p);
  else {
    const seed: PhaseId = opts.focus === 'auto' ? view.currentPhase : opts.focus;
    expanded.add(seed);
    const budget = opts.bodyColumns * PX_PER_COL * 1.25;
    let lo = phaseIndex(seed);
    let hi = lo;
    for (;;) {
      let grew = false;
      for (const dir of [1, -1] as const) {
        let i = (dir === 1 ? hi : lo) + dir;
        while (i >= 0 && i < PHASES.length && S(PHASES[i]!) === 0) i += dir;
        if (i < 0 || i >= PHASES.length) continue;
        const next = new Set(expanded).add(PHASES[i]!);
        if (canvasW(next) > budget) continue;
        expanded.add(PHASES[i]!);
        if (dir === 1) hi = i;
        else lo = i;
        grew = true;
      }
      if (!grew) break;
    }
  }
  const isExpanded = (p: PhaseId): boolean => expanded.has(p) && S(p) > 0;

  // edges between items (before geometry); dep -> block
  interface RawEdge {
    from: string;
    to: string;
    cyc: boolean;
    fromId: string;
  }
  const rawEdges = new Map<string, RawEdge>();
  for (const v of blocks) {
    if (inAgg(v)) continue;
    for (const u of visibleDeps(v)) {
      if (u === v.id) continue;
      const from = rep(u);
      const key = `${from}>${v.id}`;
      const c = cyc.has(`${u}>${v.id}`);
      const prev = rawEdges.get(key);
      if (prev) prev.cyc = prev.cyc && c;
      else rawEdges.set(key, { from, to: v.id, cyc: c, fromId: u });
    }
  }
  const edgesList = [...rawEdges.values()].sort((a, b) => (a.from === b.from ? cmpNodeId(a.to, b.to) : cmpNodeId(a.from, b.from)));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edgesList) {
    if (e.cyc) continue;
    (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)!).push(e.from);
    (succs.get(e.from) ?? succs.set(e.from, []).get(e.from)!).push(e.to);
  }

  const hWidth = canvasW(expanded);
  const orientation = opts.orientation ?? 'horizontal';
  if (orientation === 'vertical' || (orientation === 'auto' && hWidth > opts.bodyColumns * PX_PER_COL)) return buildVertical();

  // 6. row order: forward barycenter pass
  const slotOf = new Map<string, number>();
  const colOf = new Map<string, number>();
  const hadPred = new Set<string>();
  const colMembers = new Map<string, string[]>(); // `${phase}:${col}` -> ids in slot order
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const p of PHASES) {
    if (!isExpanded(p)) continue;
    const list = items.get(p)!;
    const widths = ranksPerPhase.get(p)!;
    let base = 0;
    for (let r = 0; r < widths.length; r++) {
      const group = list.filter((i) => i.rank === r);
      const keyed: { i: Item; key: number }[] = [];
      const free: Item[] = [];
      for (const i of group) {
        const placed = (preds.get(i.id) ?? []).filter((d) => slotOf.has(d)).map((d) => slotOf.get(d)!);
        if (placed.length > 0) {
          keyed.push({ i, key: mean(placed) });
          hadPred.add(i.id);
        } else free.push(i);
      }
      keyed.sort((a, b) => a.key - b.key || cmpNodeId(a.i.id, b.i.id));
      free.sort((a, b) => cmpNodeId(a.id, b.id));
      const ordered = [...keyed.map((k) => k.i), ...free];
      ordered.forEach((i, n) => {
        const col = base + Math.floor(n / MAXR);
        const slot = n % MAXR;
        slotOf.set(i.id, slot);
        colOf.set(i.id, col);
        const k = `${p}:${col}`;
        (colMembers.get(k) ?? colMembers.set(k, []).get(k)!)[slot] = i.id;
      });
      base += widths[r]!;
    }
  }
  // second pass: dep-less nodes by successors, among the slots they already occupy
  for (const members of colMembers.values()) {
    const free = members.filter((id) => !hadPred.has(id));
    if (free.length < 2) continue;
    const positions = free.map((id) => slotOf.get(id)!).sort((a, b) => a - b);
    const key = (id: string): number => {
      const s = (succs.get(id) ?? []).filter((d) => slotOf.has(d)).map((d) => slotOf.get(d)!);
      return s.length ? mean(s) : Number.POSITIVE_INFINITY;
    };
    const keys = new Map(free.map((id) => [id, key(id)]));
    const sorted = free.slice().sort((a, b) => {
      const ka = keys.get(a)!;
      const kb = keys.get(b)!;
      return ka === kb ? cmpNodeId(a, b) : ka < kb ? -1 : 1;
    });
    sorted.forEach((id, n) => {
      slotOf.set(id, positions[n]!);
    });
  }

  // 5. geometry
  const laneX: number[] = [];
  const laneW: number[] = [];
  let x = M;
  PHASES.forEach((p, i) => {
    const w = isExpanded(p) ? naturalW(p) : MINW;
    laneX[i] = x;
    laneW[i] = w;
    x += w + LG;
  });
  const maxSlots = Math.max(
    2,
    ...[...colMembers.values()].map((m) => m.length),
  );
  const bodyBottom = M + HH + maxSlots * (NH + RG);
  const height = bodyBottom + LEG + M;
  const width = laneX[PHASES.length - 1]! + laneW[PHASES.length - 1]! + M;

  const lanes: LayoutLane[] = PHASES.map((p, i) => {
    const vis = blocks.filter((b) => b.phase === p);
    const counts = Object.fromEntries(BLOCK_STATUSES.map((s) => [s, vis.filter((b) => b.status === s).length])) as Record<BlockStatus, number>;
    return {
      phase: p,
      x: laneX[i]!,
      w: laneW[i]!,
      collapsed: !isExpanded(p),
      current: i === cur,
      later: i > cur,
      reopened: reopenedSet.has(p),
      cols: isExpanded(p) ? S(p) : 0,
      total: vis.length,
      done: counts.done,
      counts,
    };
  });

  const nodes: LayoutNode[] = [];
  for (const p of PHASES) {
    if (!isExpanded(p)) continue;
    const lx = laneX[phaseIndex(p)]!;
    for (const i of items.get(p)!) {
      const col = colOf.get(i.id)!;
      const slot = slotOf.get(i.id)!;
      nodes.push({
        id: i.id,
        kind: i.block ? 'block' : 'agg',
        phase: p,
        x: lx + LP + col * (NW + CG),
        y: M + HH + slot * (NH + RG),
        w: NW,
        h: NH,
        col,
        slot,
        ...(i.block ? { block: i.block } : { count: i.count }),
      });
    }
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const statusOf = (id: string): BlockStatus => (id.startsWith('done:') ? 'done' : byId.get(id)!.status);
  const edges: LayoutEdge[] = [];
  const stubSeen = new Map<string, LayoutEdge>();
  const sel = opts.selected;
  for (const e of edgesList) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a && !b) continue;
    const done = statusOf(e.from) === 'done';
    const selected = sel !== undefined && (e.from === sel || e.to === sel);
    if (a && b) {
      const backward = e.cyc || phaseIndex(a.phase) > phaseIndex(b.phase);
      if (!backward) {
        const x1 = a.x + NW;
        const x2 = b.x;
        edges.push({
          from: e.from, to: e.to, kind: 'forward', x1, y1: a.y + NH / 2, x2, y2: b.y + NH / 2,
          k: Math.round(Math.max(20, (x2 - x1 - NW) / 2)), done, selected,
        });
      } else {
        edges.push({
          from: e.from, to: e.to, kind: 'backward', x1: a.x + NW / 2, y1: a.y + NH, x2: b.x + NW / 2, y2: b.y + NH,
          k: bodyBottom + 6, done, selected,
        });
      }
      continue;
    }
    const outward = !!a;
    const key = outward ? `out:${e.from}` : `in:${e.to}`;
    const seen = stubSeen.get(key);
    if (seen) {
      seen.selected = seen.selected || selected;
      continue;
    }
    const n = (a ?? b)!;
    const y = n.y + NH / 2;
    const stub: LayoutEdge = outward
      ? { from: e.from, to: e.to, kind: 'stub', x1: n.x + NW, y1: y, x2: n.x + NW + STUB, y2: y, k: 0, done, selected }
      : { from: e.from, to: e.to, kind: 'stub', x1: n.x - STUB, y1: y, x2: n.x, y2: y, k: 0, done, selected };
    stubSeen.set(key, stub);
    edges.push(stub);
  }

  const gates: LayoutGate[] = (['route', 'release'] as const).map((g) => {
    const i = phaseIndex(g);
    const gv = view.gates[g];
    return {
      gate: g,
      x: laneX[i]! - LG / 2,
      y1: M,
      y2: bodyBottom,
      approved: gv.approved,
      ...(gv.by ? { by: gv.by } : {}),
      ...(gv.at ? { at: gv.at } : {}),
    };
  });

  return { orientation: 'horizontal', lanes, nodes, edges, gates, width, height, bodyBottom };

  /** Phases as bands stacked top to bottom; nodes fill each band row by row, so a narrow pane scrolls instead of scaling. */
  function buildVertical(): Layout {
    const availW = Math.max(320, (opts.widthPx ?? opts.bodyColumns * PX_PER_COL) - 2 * M);
    const perRow = Math.max(1, Math.floor((availW - 2 * LP + CGV) / (NWV + CGV)));
    const nwe = Math.floor((availW - 2 * LP - (perRow - 1) * CGV) / perRow);

    const open = (p: PhaseId): boolean => {
      if (S(p) === 0) return false;
      const i = phaseIndex(p);
      if (opts.focus === 'all') return true;
      if (opts.focus !== 'auto') return opts.focus === p;
      if (reopenedSet.has(p)) return true;
      if (opts.collapseDone && items.get(p)!.every((it) => !it.block)) return false;
      return Math.abs(i - cur) <= 1;
    };

    const bands: LayoutLane[] = [];
    const nodes: LayoutNode[] = [];
    const bandTop: number[] = [];
    let y = M;
    PHASES.forEach((p, i) => {
      if (i > 0) y += i === 1 || i === 5 ? GATE_GAP : BAND_GAP;
      const vis = blocks.filter((b) => b.phase === p);
      const counts = Object.fromEntries(BLOCK_STATUSES.map((st) => [st, vis.filter((b) => b.status === st).length])) as Record<BlockStatus, number>;
      const isOpen = open(p);
      let h = COLLAPSED_H;
      if (isOpen) {
        let row = 0;
        const list = items.get(p)!;
        const ranks = [...new Set(list.map((it) => it.rank))].sort((a, b) => a - b);
        for (const r of ranks) {
          const group = list.filter((it) => it.rank === r).sort((a, b) => cmpNodeId(a.id, b.id));
          group.forEach((it, n) => {
            const slot = row + Math.floor(n / perRow);
            nodes.push({
              id: it.id,
              kind: it.block ? 'block' : 'agg',
              phase: p,
              x: M + LP + (n % perRow) * (nwe + CGV),
              y: y + HBAND + slot * (NHV + RGV),
              w: nwe,
              h: NHV,
              col: n % perRow,
              slot,
              ...(it.block ? { block: it.block } : { count: it.count }),
            });
          });
          row += Math.ceil(group.length / perRow);
        }
        h = HBAND + row * (NHV + RGV) + 2;
      }
      bandTop[i] = y;
      bands.push({
        phase: p, x: M, w: availW, collapsed: !isOpen, current: i === cur, later: i > cur, reopened: reopenedSet.has(p), cols: isOpen ? perRow : 0,
        total: vis.length, done: counts.done, counts, y, h,
      });
      y += h;
    });
    const bodyBottom = y;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const statusOf = (id: string): BlockStatus => (id.startsWith('done:') ? 'done' : byId.get(id)!.status);
    const loopX = M + availW - 4;
    const edges: LayoutEdge[] = [];
    const stubSeen = new Map<string, LayoutEdge>();
    for (const e of edgesList) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a && !b) continue;
      const done = statusOf(e.from) === 'done';
      const selected = opts.selected !== undefined && (e.from === opts.selected || e.to === opts.selected);
      if (a && b) {
        const down = !e.cyc && b.y > a.y + a.h;
        if (down) {
          const y1 = a.y + a.h;
          const y2 = b.y;
          edges.push({ from: e.from, to: e.to, kind: 'forward', x1: a.x + a.w / 2, y1, x2: b.x + b.w / 2, y2, k: Math.round(Math.max(16, (y2 - y1) / 2)), done, selected });
        } else
          edges.push({ from: e.from, to: e.to, kind: 'backward', x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2, k: loopX, done, selected });
        continue;
      }
      const outward = !!a;
      const key = outward ? `out:${e.from}` : `in:${e.to}`;
      const seen = stubSeen.get(key);
      if (seen) {
        seen.selected = seen.selected || selected;
        continue;
      }
      const n = (a ?? b)!;
      const cx = n.x + n.w / 2;
      const stub: LayoutEdge = outward
        ? { from: e.from, to: e.to, kind: 'stub', x1: cx, y1: n.y + n.h, x2: cx, y2: n.y + n.h + 8, k: 0, done, selected }
        : { from: e.from, to: e.to, kind: 'stub', x1: cx, y1: n.y - 8, x2: cx, y2: n.y, k: 0, done, selected };
      stubSeen.set(key, stub);
      edges.push(stub);
    }

    const gates: LayoutGate[] = (['route', 'release'] as const).map((g) => {
      const i = phaseIndex(g);
      const gv = view.gates[g];
      const prevBottom = bandTop[i - 1]! + bands[i - 1]!.h!;
      return {
        gate: g,
        x: M,
        y1: prevBottom,
        y2: bandTop[i]!,
        y: Math.round((prevBottom + bandTop[i]!) / 2),
        approved: gv.approved,
        ...(gv.by ? { by: gv.by } : {}),
        ...(gv.at ? { at: gv.at } : {}),
      };
    });
    const width = availW + 2 * M;
    return { orientation: 'vertical', lanes: bands, nodes, edges, gates, width, height: bodyBottom + 14 + legendRows(width) * LEG_ROW + M, bodyBottom };
  }
}

/** `done:<phase>` aggregates sort by phase order, block ids numerically. */
function cmpNodeId(a: string, b: string): number {
  const aa = a.startsWith('done:');
  const ab = b.startsWith('done:');
  if (aa || ab) {
    if (aa && ab) return phaseIndex(a.slice(5) as PhaseId) - phaseIndex(b.slice(5) as PhaseId);
    return aa ? -1 : 1;
  }
  return compareIds(a, b);
}
