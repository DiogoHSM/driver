import { PHASES, PlanV1Schema, comparePhase, phaseIndex, type Block, type PlanV1 } from './schema.js';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ValidateOptions {
  fs?: { exists(path: string): boolean };
  driverDir?: string;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

const isActive = (b: Block): boolean => b.retired === undefined;

const idNumber = (id: string): number => Number(id.slice(id.indexOf('-') + 1));

const maxId = (ids: string[]): number => ids.reduce((m, id) => Math.max(m, idNumber(id)), 0);

function formatPath(path: PropertyKey[]): string {
  return path.map(String).join('.');
}

function dupes(values: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) out.add(v);
    seen.add(v);
  }
  return [...out];
}

function findCycle(blocks: Record<string, Block>): string[] {
  const active = Object.keys(blocks).filter((id) => isActive(blocks[id]!));
  const activeSet = new Set(active);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of active) {
    const deps = blocks[id]!.dependsOn.filter((d) => activeSet.has(d));
    indegree.set(id, new Set(deps).size);
    for (const d of new Set(deps)) dependents.set(d, [...(dependents.get(d) ?? []), id]);
  }
  const queue = active.filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of dependents.get(id) ?? []) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  return visited === active.length ? [] : active.filter((id) => indegree.get(id)! > 0);
}

export function validatePlan(plan: unknown, opts: ValidateOptions = {}): Issue[] {
  const parsed = PlanV1Schema.safeParse(plan);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      level: 'error',
      code: 'schema',
      path: formatPath(i.path),
      message: i.message,
    }));
  }
  const p: PlanV1 = parsed.data;
  const issues: Issue[] = [];
  const add = (level: Issue['level'], code: string, path: string, message: string) =>
    issues.push({ level, code, path, message });

  const blockIds = Object.keys(p.blocks);
  const reqIds = Object.keys(p.requirements);

  for (const d of dupes(p.releases.map((r) => r.id)))
    add('error', 'ids.duplicate', 'releases', `duplicate release id ${d}`);
  for (const d of dupes(p.baselines.map((b) => String(b.n))))
    add('error', 'ids.duplicate', 'baselines', `duplicate baseline number ${d}`);

  const decisionIds = [
    ...Object.keys(p.decisions ?? {}),
    ...p.baselines.map((b) => b.decision),
    ...blockIds.flatMap((id) => (p.blocks[id]!.retired ? [p.blocks[id]!.retired!.decision] : [])),
    ...reqIds.flatMap((id) => (p.requirements[id]!.retired ? [p.requirements[id]!.retired!.decision] : [])),
  ];
  if (p.decisions) {
    const cited: [string, string][] = [
      ...p.baselines.map((b, i): [string, string] => [`baselines.${i}.decision`, b.decision]),
      ...blockIds.flatMap((id): [string, string][] => (p.blocks[id]!.retired ? [[`blocks.${id}.retired.decision`, p.blocks[id]!.retired!.decision]] : [])),
      ...reqIds.flatMap((id): [string, string][] => (p.requirements[id]!.retired ? [[`requirements.${id}.retired.decision`, p.requirements[id]!.retired!.decision]] : [])),
    ];
    for (const [path, d] of cited)
      if (!(d in p.decisions)) add('error', 'ref.decision', path, `${d} is not registered in decisions`);
  }
  const counters: ['R' | 'B' | 'D' | 'REL', number][] = [
    ['R', maxId(reqIds)],
    ['B', maxId(blockIds)],
    ['D', maxId(decisionIds)],
    ['REL', maxId(p.releases.map((r) => r.id))],
  ];
  for (const [key, max] of counters) {
    if (p.nextId[key] <= max)
      add('error', 'ids.nextId', `nextId.${key}`, `nextId.${key} (${p.nextId[key]}) must be greater than max existing id (${max})`);
  }

  for (const id of blockIds) {
    const b = p.blocks[id]!;
    const base = `blocks.${id}`;
    for (const d of dupes(b.dependsOn))
      add('error', 'ids.duplicate', `${base}.dependsOn`, `duplicate dependency ${d}`);
    b.dependsOn.forEach((dep, i) => {
      if (!(dep in p.blocks))
        add('error', 'ref.dependsOn', `${base}.dependsOn.${i}`, `${dep} does not exist`);
      else if (comparePhase(p.blocks[dep]!.phase, b.phase) > 0)
        add('error', 'deps.laterPhase', `${base}.dependsOn.${i}`, `${id} (${b.phase}) depends on ${dep} from later phase ${p.blocks[dep]!.phase}`);
    });
    b.requirements.forEach((r, i) => {
      if (!(r in p.requirements))
        add('error', 'ref.requirement', `${base}.requirements.${i}`, `${r} does not exist`);
    });
    if ((b.status === 'blocked' || b.status === 'needs_rework') && !b.statusReason)
      add('error', 'status.reason', `${base}.statusReason`, `status ${b.status} requires statusReason`);
    if (b.owner !== undefined && b.status !== 'in_progress')
      add('error', 'status.owner', `${base}.owner`, `owner is only allowed while in_progress (status is ${b.status})`);
    if (opts.fs && opts.driverDir !== undefined && isActive(b)) {
      const file = `${opts.driverDir.replace(/\/+$/, '')}/blocks/${id}.md`;
      if (!opts.fs.exists(file)) add('error', 'doc.missing', base, `missing ${file}`);
    }
  }

  for (const cyc of [findCycle(p.blocks)].filter((c) => c.length > 0))
    add('error', 'deps.cycle', 'blocks', `dependency cycle among: ${cyc.join(', ')}`);

  p.releases.forEach((r, i) =>
    r.blocks.forEach((b, j) => {
      if (!(b in p.blocks)) add('error', 'ref.release', `releases.${i}.blocks.${j}`, `${b} does not exist`);
    }),
  );

  if (p.baselines.length !== p.baseline)
    add('error', 'baseline.mismatch', 'baseline', `baseline is ${p.baseline} but baselines has ${p.baselines.length} entries`);

  if (comparePhase(p.currentPhase, 'discover') > 0 && !p.gates.route.approved)
    add('error', 'gate.route', 'gates.route', `phase ${p.currentPhase} requires gates.route.approved`);
  if (p.currentPhase === 'release' && !p.gates.release.approved)
    add('error', 'gate.release', 'gates.release', 'phase release requires gates.release.approved');

  for (const id of blockIds) {
    const b = p.blocks[id]!;
    if (isActive(b) && comparePhase(b.phase, p.currentPhase) > 0 && b.status !== 'not_started')
      add('warning', 'phases.currentValid', `blocks.${id}.status`, `block in later phase ${b.phase} is ${b.status} while currentPhase is ${p.currentPhase}`);
  }

  const activeBlocks = blockIds.filter((id) => isActive(p.blocks[id]!));
  // Requirements may enter at any phase before release (gate.releaseIncomplete re-checks at Gate 2).
  const coverageLevel: Issue['level'] = p.currentPhase === 'release' ? 'error' : 'warning';
  for (const rid of reqIds) {
    const r = p.requirements[rid]!;
    if (r.retired || r.kind === 'non-goal') continue;
    if (!activeBlocks.some((id) => p.blocks[id]!.requirements.includes(rid)))
      add(coverageLevel, 'req.coverage', `requirements.${rid}`, `${rid} is not covered by any active block`);
  }

  if (p.currentPhase === 'release') {
    const middle = PHASES.slice(phaseIndex('implement'), phaseIndex('evolve') + 1);
    for (const id of activeBlocks) {
      const b = p.blocks[id]!;
      if ((middle as readonly string[]).includes(b.phase) && b.status !== 'done')
        add('error', 'gate.releaseIncomplete', `blocks.${id}`, `${id} is ${b.status}; release requires done`);
    }
    for (const rid of reqIds) {
      const r = p.requirements[rid]!;
      if (r.retired || r.kind === 'non-goal') continue;
      const verified = activeBlocks.some((id) => {
        const b = p.blocks[id]!;
        return b.requirements.includes(rid) && b.status === 'done' && b.verification?.passes === true;
      });
      if (!verified)
        add('error', 'gate.releaseIncomplete', `requirements.${rid}`, `${rid} has no done block with passing verification`);
    }
  }

  return issues;
}
