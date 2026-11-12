import { BLOCK_STATUSES, PHASES, phaseIndex, type BlockStatus, type PhaseId } from './phases.js';
import type { GateName, PlanDoc } from './plan-doc.js';

export interface BlockView {
  id: string;
  title: string;
  phase: PhaseId;
  status: BlockStatus;
  owner?: string;
  reason?: string;
  deps: string[];
  reqs: number;
  tests: { pass: number; fail: number; unknown: number };
  verified?: boolean;
  risk?: 'low' | 'medium' | 'high';
  retired: boolean;
  since: string;
  /** True when the block entered the plan after the current baseline was confirmed. */
  afterBaseline?: boolean;
  /** For a blocked block: dependencies that are not done yet (retired ones do not count). */
  waitingOn?: string[];
}

export interface GateView {
  approved: boolean;
  by?: string;
  at?: string;
  /** Set when the approval went through the mod's ticket channel. */
  via?: string;
  ticket?: string;
}

export interface PlanView {
  project: string;
  revision: number;
  baseline: number;
  currentPhase: PhaseId;
  gates: Record<GateName, GateView>;
  blocks: BlockView[];
  /** Non-retired requirements that entered after the current baseline (0 at baseline 0). */
  reqsAfterBaseline: number;
  /** Phases before the current one that still hold unfinished work (validate onward only). */
  openBehind: PhaseId[];
  /** The latest baseline entry, with how it was confirmed when that was recorded. */
  latestBaseline?: { n: number; via?: string; ticket?: string };
}

/** Only the loop phases are ever reported as left open behind the current one. */
const LOOP_PHASES: readonly PhaseId[] = ['implement', 'validate'];

/** What entered the plan after the current baseline: non-retired blocks and requirements. */
export function sinceBaseline(view: Pick<PlanView, 'blocks' | 'reqsAfterBaseline'>): { blocks: number; reqs: number } {
  return { blocks: view.blocks.filter((b) => b.afterBaseline && !b.retired).length, reqs: view.reqsAfterBaseline ?? 0 };
}

/** `baseline 1`, or `baseline 1 · +4 since` when blocks or requirements entered after it. */
export function baselineText(view: Pick<PlanView, 'baseline' | 'blocks' | 'reqsAfterBaseline'>): string {
  const n = sinceBaseline(view);
  const added = n.blocks + n.reqs;
  return added > 0 ? `baseline ${view.baseline} · +${added} since` : `baseline ${view.baseline}`;
}

const WAITING_ON = /^waiting on (B-\d+)\b/i;

/**
 * A blocked block can be picked up again only when it was blocked for a named dependency
 * ("waiting on B-012"), that block is one of its dependencies, and it is done now. A block held by
 * a credential or by the person also has its dependencies done, and a reason that merely mentions
 * a block ("needed by B-005") is not a wait.
 */
export function isResumable(b: Pick<BlockView, 'status' | 'reason' | 'deps'>, byId: ReadonlyMap<string, Pick<BlockView, 'status'>>): boolean {
  if (b.status !== 'blocked') return false;
  const named = WAITING_ON.exec(b.reason ?? '')?.[1]?.toUpperCase();
  return named !== undefined && b.deps.includes(named) && byId.get(named)?.status === 'done';
}

/** Numeric-aware id order (B-9 < B-10), stable for any key order of the input. */
export function compareIds(a: string, b: string): number {
  const na = Number(a.slice(a.indexOf('-') + 1));
  const nb = Number(b.slice(b.indexOf('-') + 1));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function gateView(g: PlanDoc['gates']['route'] | undefined): GateView {
  return {
    approved: g?.approved === true,
    ...(g?.approvedBy ? { by: g.approvedBy } : {}),
    ...(g?.approvedAt ? { at: g.approvedAt } : {}),
    ...(g?.approvedVia ? { via: g.approvedVia } : {}),
    ...(g?.approvedTicket ? { ticket: g.approvedTicket } : {}),
  };
}

export function project(plan: PlanDoc): PlanView {
  const baselines = plan.baselines ?? [];
  const inBaseline = new Set<string>();
  const reqInBaseline = new Set<string>();
  for (const bl of baselines) {
    for (const id of bl.added ?? []) inBaseline.add(id);
    for (const id of bl.reqAdded ?? []) reqInBaseline.add(id);
  }
  // Baseline 1 stays open until Route ends: a lone entry without closedAt cannot say what came after it.
  const unclosed = baselines.length === 1 && baselines[0]!.closedAt === undefined;
  const marking = plan.baseline >= 1 && plan.baselines !== undefined && !unclosed;
  const blocks: BlockView[] = Object.keys(plan.blocks)
    .sort(compareIds)
    .map((id) => {
      const b = plan.blocks[id]!;
      const tests = { pass: 0, fail: 0, unknown: 0 };
      for (const t of b.tests ?? []) if (t.result in tests) tests[t.result]++;
      const waiting =
        b.status === 'blocked'
          ? [...(b.dependsOn ?? [])]
              .filter((d) => {
                const dep = plan.blocks[d];
                return !!dep && !dep.retired && dep.status !== 'done';
              })
              .sort(compareIds)
          : [];
      return {
        id,
        title: b.title,
        phase: b.phase,
        status: b.status,
        ...(b.owner ? { owner: b.owner } : {}),
        ...(b.statusReason ? { reason: b.statusReason } : {}),
        deps: [...(b.dependsOn ?? [])].sort(compareIds),
        reqs: (b.requirements ?? []).length,
        tests,
        ...(b.verification ? { verified: b.verification.passes === true } : {}),
        ...(b.risk ? { risk: b.risk } : {}),
        retired: !!b.retired,
        since: b.statusSince,
        ...(marking && !inBaseline.has(id) ? { afterBaseline: true } : {}),
        ...(waiting.length ? { waitingOn: waiting } : {}),
      };
    });
  const cur = phaseIndex(plan.currentPhase);
  const openBehind: PhaseId[] =
    cur < phaseIndex('validate')
      ? []
      : LOOP_PHASES.filter(
          (ph) => phaseIndex(ph) < cur && blocks.some((b) => b.phase === ph && !b.retired && b.status !== 'done'),
        );
  const reqsAfterBaseline = marking
    ? Object.entries(plan.requirements ?? {}).filter(([id, r]) => !r.retired && !reqInBaseline.has(id)).length
    : 0;
  const latest = baselines[baselines.length - 1];
  return {
    project: plan.project?.name ?? '',
    revision: plan.revision,
    baseline: plan.baseline,
    currentPhase: plan.currentPhase,
    gates: { route: gateView(plan.gates?.route), release: gateView(plan.gates?.release) },
    blocks,
    reqsAfterBaseline,
    openBehind,
    ...(latest
      ? { latestBaseline: { n: latest.n, ...(latest.via ? { via: latest.via } : {}), ...(latest.ticket ? { ticket: latest.ticket } : {}) } }
      : {}),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArr = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
const BLOCK_ID = /^B-\d{3,}$/;

/** Structural checks only (the node side runs the full zod + invariant validation). */
export function shapeCheck(raw: unknown): { ok: true; plan: PlanDoc } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!isObj(raw)) return bad('plan.json is not an object');
  if (raw.schemaVersion !== 1) return bad(`unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}`);
  if (!isObj(raw.project) || typeof raw.project.name !== 'string') return bad('project.name missing');
  if (typeof raw.revision !== 'number') return bad('revision missing');
  if (typeof raw.baseline !== 'number') return bad('baseline missing');
  if (!(PHASES as readonly unknown[]).includes(raw.currentPhase)) return bad(`currentPhase invalid: ${String(raw.currentPhase)}`);
  if (!isObj(raw.gates) || !isObj(raw.gates.route) || !isObj(raw.gates.release)) return bad('gates.route/release missing');
  if (!isObj(raw.requirements)) return bad('requirements is not an object');
  if (!isObj(raw.blocks)) return bad('blocks is not an object');
  for (const [id, b] of Object.entries(raw.blocks)) {
    if (!BLOCK_ID.test(id)) return bad(`malformed block id ${id}`);
    if (!isObj(b)) return bad(`${id} is not an object`);
    if (typeof b.title !== 'string') return bad(`${id}.title missing`);
    if (!(PHASES as readonly unknown[]).includes(b.phase)) return bad(`${id}.phase invalid: ${String(b.phase)}`);
    if (!(BLOCK_STATUSES as readonly unknown[]).includes(b.status)) return bad(`${id}.status invalid: ${String(b.status)}`);
    if (!isStrArr(b.dependsOn)) return bad(`${id}.dependsOn is not a string list`);
    if (!isStrArr(b.requirements)) return bad(`${id}.requirements is not a string list`);
    if (!Array.isArray(b.tests)) return bad(`${id}.tests is not a list`);
    if (typeof b.statusSince !== 'string') return bad(`${id}.statusSince missing`);
  }
  return { ok: true, plan: raw as unknown as PlanDoc };
}

export interface Summary {
  counts: Record<BlockStatus, number>;
  ready: string[];
  rework: string[];
  resumable: string[];
  inProgress: { id: string; owner?: string }[];
  blocked: { id: string; reason?: string }[];
  nextGate?: GateName;
}

export function summarize(view: PlanView): Summary {
  const counts = Object.fromEntries(BLOCK_STATUSES.map((s) => [s, 0])) as Record<BlockStatus, number>;
  const byId = new Map(view.blocks.map((b) => [b.id, b]));
  const active = view.blocks.filter((b) => !b.retired);
  for (const b of active) counts[b.status]++;
  const cur = phaseIndex(view.currentPhase);
  const depMet = (id: string): boolean => {
    const d = byId.get(id);
    return !!d && (d.retired || d.status === 'done');
  };
  const nextGate: GateName | undefined = !view.gates.route.approved ? 'route' : !view.gates.release.approved ? 'release' : undefined;
  return {
    counts,
    rework: active.filter((b) => b.status === 'needs_rework' && phaseIndex(b.phase) <= cur).map((b) => b.id),
    resumable: active
      .filter((b) => b.status === 'blocked' && b.deps.length > 0 && b.deps.every(depMet))
      .map((b) => b.id),
    ready: active.filter((b) => b.status === 'not_started' && phaseIndex(b.phase) <= cur && b.deps.every(depMet)).map((b) => b.id),
    inProgress: active.filter((b) => b.status === 'in_progress').map((b) => ({ id: b.id, ...(b.owner ? { owner: b.owner } : {}) })),
    blocked: active.filter((b) => b.status === 'blocked').map((b) => ({ id: b.id, ...(b.reason ? { reason: b.reason } : {}) })),
    ...(nextGate ? { nextGate } : {}),
  };
}
