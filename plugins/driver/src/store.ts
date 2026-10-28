import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { OpRefusedError, applyOp, type Event, type Op, type OpContext } from './reducer.js';
import { PlanV1Schema, emptyPlan, type PlanV1 } from './schema.js';

export class LockTimeoutError extends Error {
  constructor(lockDir: string) {
    super(`could not acquire ${lockDir} within timeout`);
    this.name = 'LockTimeoutError';
  }
}

export class RevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`expected revision ${expected} but plan is at ${actual}`);
    this.name = 'RevisionConflictError';
  }
}

export class NotInitializedError extends Error {
  constructor(driverDir: string) {
    super(`no plan at ${driverDir}/plan.json (run "driver init <name>")`);
    this.name = 'NotInitializedError';
  }
}

const git = (cwd: string, args: string[]): string | undefined => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
};

/** First non-bare entry of `git worktree list --porcelain`, i.e. the main worktree. */
export function parseMainWorktree(porcelain: string): string | undefined {
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (wt && !lines.includes('bare')) return wt.slice('worktree '.length);
  }
  return undefined;
}

/** Main worktree root, so agents in linked worktrees never write their stale copy. */
export function resolveProjectRoot(cwd: string): string {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  const main = parseMainWorktree(git(cwd, ['worktree', 'list', '--porcelain']) ?? '');
  // In a submodule `worktree list` reports the gitdir under .git/modules/, not a working tree.
  if (main && !/[\\/]\.git[\\/]modules[\\/]/.test(main)) return main;
  return top ? top : path.resolve(cwd);
}

export const driverDirOf = (root: string): string => path.join(root, '.claude', 'driver');

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockAgeAndOwner(lockDir: string): { ts: number; pid?: number } | undefined {
  try {
    const o = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8')) as { pid?: unknown; ts?: unknown };
    const ts = typeof o.ts === 'number' ? o.ts : Date.parse(String(o.ts));
    if (Number.isFinite(ts)) return { ts, pid: typeof o.pid === 'number' ? o.pid : undefined };
  } catch {
    // owner.json not written yet, or corrupt: fall back to the directory mtime
  }
  try {
    return { ts: statSync(lockDir).mtimeMs };
  } catch {
    return undefined;
  }
}

export function isStale(lockDir: string): boolean {
  const o = lockAgeAndOwner(lockDir);
  if (!o) return false;
  if (Date.now() - o.ts <= LOCK_STALE_MS) return false;
  return o.pid === undefined || !pidAlive(o.pid);
}

/**
 * Moves a stale lock aside with an atomic rename: of several processes that judged it
 * stale, exactly one succeeds. Returns true when the lock is gone (by us or by a rival).
 */
export function recoverStaleLock(lockDir: string): boolean {
  if (!isStale(lockDir)) return !existsSync(lockDir);
  const aside = `${lockDir}.stale.${process.pid}.${Date.now()}`;
  try {
    renameSync(lockDir, aside);
  } catch {
    return false; // lost the race: somebody else removed or replaced it
  }
  if (!isStale(aside)) {
    // we moved a fresh lock created after our check; put it back if possible
    try {
      renameSync(aside, lockDir);
    } catch {
      // someone already took the lock; the displaced owner will notice via its own release
    }
    return false;
  }
  rmSync(aside, { recursive: true, force: true });
  return true;
}

export function withLock<T>(driverDir: string, fn: () => T, timeoutMs = LOCK_TIMEOUT_MS): T {
  const lockDir = path.join(driverDir, '.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (recoverStaleLock(lockDir)) continue;
      if (Date.now() >= deadline) throw new LockTimeoutError(lockDir);
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }));
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export function readPlan(driverDir: string): PlanV1 {
  const file = path.join(driverDir, 'plan.json');
  if (!existsSync(file)) throw new NotInitializedError(driverDir);
  return PlanV1Schema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

export const serializePlan = (plan: PlanV1): string => `${JSON.stringify(sortKeys(plan), null, 2)}\n`;

export function writePlan(driverDir: string, plan: PlanV1): void {
  const tmpDir = path.join(driverDir, '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `plan.json.${process.pid}`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, serializePlan(plan));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path.join(driverDir, 'plan.json'));
}

function tailSeq(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const size = statSync(file).size;
  if (size === 0) return undefined;
  const fd = openSync(file, 'r');
  try {
    let len = Math.min(size, 4096);
    for (;;) {
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const text = buf.toString('utf8').trimEnd();
      const nl = text.lastIndexOf('\n');
      if (nl >= 0 || len === size) {
        const seq = (JSON.parse(text.slice(nl + 1)) as { seq?: unknown }).seq;
        if (typeof seq !== 'number') throw new Error(`${file}: last line has no numeric seq`);
        return seq;
      }
      len = Math.min(size, len * 2);
    }
  } finally {
    closeSync(fd);
  }
}

const relNumber = (f: string): number => Number(/(\d+)\.jsonl$/.exec(f)?.[1] ?? 0);

/** Rotated ledgers (log/REL-n.jsonl), oldest first. */
export function rotatedLogs(driverDir: string): string[] {
  const dir = path.join(driverDir, 'log');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort((a, b) => relNumber(a) - relNumber(b))
    .map((f) => path.join(dir, f));
}

function lastSeq(driverDir: string): number {
  const current = tailSeq(path.join(driverDir, 'events.jsonl'));
  if (current !== undefined) return current;
  for (const f of rotatedLogs(driverDir).reverse()) {
    const seq = tailSeq(f);
    if (seq !== undefined) return seq;
  }
  return 0;
}

function orderEvent(e: Event): Event {
  const { seq, ts, revision, actor, type, block, from, to, reason, data } = e;
  const o: Record<string, unknown> = { seq, ts, revision, actor, type, block, from, to, reason, data };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return sortKeysShallowData(o) as unknown as Event;
}

const sortKeysShallowData = (o: Record<string, unknown>): Record<string, unknown> => ({
  ...o,
  ...(o.data !== undefined ? { data: sortKeys(o.data) } : {}),
});

/** Caller must hold the lock: seq is last seq + 1. */
export function appendEvents(driverDir: string, events: Event[]): Event[] {
  if (events.length === 0) return [];
  const file = path.join(driverDir, 'events.jsonl');
  let seq = lastSeq(driverDir);
  const out = events.map((e) => orderEvent({ ...e, seq: ++seq }));
  appendFileSync(file, `${out.map((e) => JSON.stringify(e)).join('\n')}\n`, { flag: 'a' });
  return out;
}

function parseLines(file: string): Event[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Event);
}

/** Current ledger only (events.jsonl). */
export function readEvents(driverDir: string): Event[] {
  const file = path.join(driverDir, 'events.jsonl');
  return existsSync(file) ? parseLines(file) : [];
}

/** Rotated ledgers in release order, then the current one. */
export function readAllEvents(driverDir: string): Event[] {
  return [...rotatedLogs(driverDir).flatMap(parseLines), ...readEvents(driverDir)];
}

export interface MutateOptions {
  expectedRevision?: number;
  /** Also create requirements/<id>.md on req.add. */
  doc?: boolean;
}

export interface MutateResult {
  plan: PlanV1;
  events: Event[];
  created?: string;
}

const yamlString = (s: string): string => JSON.stringify(s);

function writeNew(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, content);
}

export function blockDocTemplate(id: string, title: string): string {
  return `---\nid: ${id}\ntitle: ${yamlString(title)}\n---\n\n# ${id} ${title}\n\n## Spec\n\n## Acceptance criteria\n\n## Notes\n\n## Handoff\n`;
}

function writeDocs(driverDir: string, op: Op, created: string | undefined, plan: PlanV1, opts: MutateOptions): void {
  if (!created) return;
  if (op.type === 'block.add') writeNew(path.join(driverDir, 'blocks', `${created}.md`), blockDocTemplate(created, op.title));
  else if (op.type === 'req.add' && opts.doc)
    writeNew(path.join(driverDir, 'requirements', `${created}.md`), `---\nid: ${created}\ntitle: ${yamlString(op.title)}\n---\n\n# ${created} ${op.title}\n`);
  else if (op.type === 'decision.add')
    writeNew(
      path.join(driverDir, 'decisions', `${created}.md`),
      `---\nid: ${created}\ntitle: ${yamlString(op.title)}\n---\n\n# ${created} ${op.title}\n${op.reason ? `\n${op.reason}\n` : ''}`,
    );
  else if (op.type === 'rebaseline' || op.type === 'gate.approve') {
    const entry = plan.baselines[plan.baselines.length - 1];
    if (entry && entry.decision === created)
      writeNew(path.join(driverDir, 'decisions', `${created}.md`), `---\nid: ${created}\nbaseline: ${entry.n}\n---\n\n# ${created}\n\n${entry.reason}\n`);
  }
}

/** `## Handoff` must exist in blocks/<id>.md with at least one non-empty line under it. */
export function checkHandoff(driverDir: string, id: string): void {
  const file = path.join(driverDir, 'blocks', `${id}.md`);
  if (!existsSync(file)) throw new OpRefusedError(`in_review requires ${file} with a ## Handoff section`);
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+Handoff\s*$/.test(l));
  if (start < 0) throw new OpRefusedError(`${id}.md has no ## Handoff section`);
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    body.push(l);
  }
  if (!body.some((l) => l.trim() !== ''))
    throw new OpRefusedError(`${id}.md: write the ## Handoff section before moving to in_review (or use --force as the user)`);
}

export function mutate(driverDir: string, op: Op, ctx: OpContext, opts: MutateOptions = {}): MutateResult {
  return withLock(driverDir, () => {
    const current = readPlan(driverDir);
    if (opts.expectedRevision !== undefined && current.revision !== opts.expectedRevision)
      throw new RevisionConflictError(opts.expectedRevision, current.revision);
    if (
      op.type === 'block.status' &&
      op.to === 'in_review' &&
      current.blocks[op.id]?.status === 'in_progress' &&
      !(op.force && ctx.actor.kind === 'user')
    )
      checkHandoff(driverDir, op.id);
    const r = applyOp(current, op, ctx);
    const plan: PlanV1 = { ...r.plan, revision: current.revision + 1 };
    // Docs first: a crash leaves an unreferenced file, never a plan without its doc.
    writeDocs(driverDir, op, r.created, plan, opts);
    writePlan(driverDir, plan);
    const events = appendEvents(
      driverDir,
      r.events.map((e) => ({ ...e, revision: plan.revision })),
    );
    if (op.type === 'release.add' && r.created) {
      // Ledger rotation (ADR-010 item 6); seq continues from the rotated file.
      mkdirSync(path.join(driverDir, 'log'), { recursive: true });
      renameSync(path.join(driverDir, 'events.jsonl'), path.join(driverDir, 'log', `${r.created}.jsonl`));
      writeFileSync(path.join(driverDir, 'events.jsonl'), '');
    }
    return { plan, events, ...(r.created ? { created: r.created } : {}) };
  });
}

export function initDriverDir(driverDir: string, name: string, packs: string[], now: string): PlanV1 {
  if (existsSync(path.join(driverDir, 'plan.json'))) throw new Error(`${driverDir}/plan.json already exists`);
  for (const d of ['blocks', 'requirements', 'decisions', 'discover', 'exports', 'log']) {
    mkdirSync(path.join(driverDir, d), { recursive: true });
    // exports/ is gitignored; keep the other empty dirs alive in git
    if (d !== 'exports') writeNew(path.join(driverDir, d, '.gitkeep'), '');
  }
  const plan = emptyPlan(name, packs, now);
  writeNew(path.join(driverDir, '.gitignore'), 'exports/\n.lock/\n.tmp/\n');
  writeNew(path.join(driverDir, '.gitattributes'), 'events.jsonl merge=union\n');
  writeNew(path.join(driverDir, 'events.jsonl'), '');
  writePlan(driverDir, plan);
  return plan;
}
