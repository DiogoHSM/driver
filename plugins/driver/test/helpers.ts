import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutate } from '../src/store.js';
import type { PlanV1 } from '../src/schema.js';

export function loadFixture(kind: 'valid' | 'invalid', name: string): any {
  const url = new URL(`./fixtures/${kind}/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CLI = path.join(PKG_ROOT, 'dist', 'cli.js');
export const GATE_SH = path.join(PKG_ROOT, 'hooks', 'gate-check.sh');
export const EXAMPLES = path.join(PKG_ROOT, '..', '..', 'examples');

export const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'driver-test-'));

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}): Run {
  const options = {
    encoding: 'utf8' as const,
    cwd: opts.cwd,
    input: opts.input ?? '',
    env: { ...process.env, ...opts.env },
    // new session: no controlling terminal, so /dev/tty confirmations always refuse (like the Bash tool)
    detached: true,
  };
  const r = spawnSync('node', [CLI, ...args], options);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function runGateSh(input: string): Run {
  const r = spawnSync('bash', [GATE_SH], { encoding: 'utf8', input });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Writes plan (object or raw string) to <dir>/.claude/driver/plan.json. */
export function writePlanFile(dir: string, plan: unknown): void {
  const d = path.join(dir, '.claude', 'driver');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'plan.json'), typeof plan === 'string' ? plan : JSON.stringify(plan));
}

export function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

export const clonePlan = (name: 'minimal-discover' | 'mid-implement' = 'mid-implement'): PlanV1 =>
  structuredClone(loadFixture('valid', name));

export const NOW = '2026-10-28T10:00:00Z';
export const USER = { kind: 'user', id: 'diogo' } as const;
export const MODEL = { kind: 'model', id: 'agent-1' } as const;
export const HOOK = { kind: 'hook', id: 'subagent-stop' } as const;

/** Gate approval as the user would do it after a TTY confirmation: straight through the store. */
export function approveAsUser(root: string, gate: 'route' | 'release'): void {
  mutate(path.join(root, '.claude', 'driver'), { type: 'gate.approve', gate }, { actor: USER, now: NOW });
}

export function loadExamplePlan(name: 'web-waitlist' | 'video-explainer'): PlanV1 {
  return JSON.parse(readFileSync(path.join(EXAMPLES, name, '.claude', 'driver', 'plan.json'), 'utf8'));
}

/** Same data, every object key order reversed (arrays keep their order unless `arrays`). */
export function shuffleKeys<T>(v: T, arrays = false): T {
  if (Array.isArray(v)) {
    const m = v.map((x) => shuffleKeys(x, arrays));
    return (arrays ? m.reverse() : m) as T;
  }
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffleKeys(x, arrays)])) as T;
  return v;
}
