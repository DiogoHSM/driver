import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { gateVerdict } from './shared/gate.js';
import type { PlanDoc } from './shared/plan-doc.js';
import { protectCommand, protectPath } from './shared/protect.js';
import { driverDirOf, resolveProjectRoot } from './store.js';

export interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
}

export function parseHookInput(raw: string): HookInput | undefined {
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as HookInput) : undefined;
  } catch {
    return undefined;
  }
}

export function denyOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/** DRIVER_ROOT, then the main worktree (linked worktrees hold a stale copy), then cwd. */
export function findPlanFile(cwd: string): string | undefined {
  const roots = [process.env.DRIVER_ROOT, resolveProjectRoot(cwd), cwd].filter((r): r is string => !!r);
  return roots.map((r) => path.join(driverDirOf(r), 'plan.json')).find((f) => existsSync(f));
}

// Mirrors jq's `a // b`: null and false fall through, "" does not.
const firstPresent = (...vs: unknown[]): unknown => vs.find((v) => v !== null && v !== undefined && v !== false);

/** Same semantics as hooks/gate-check.sh. Returns a deny reason, or null to allow. */
export function gateCheck(input: HookInput | undefined): string | null {
  const cwd = path.resolve(input?.cwd ?? process.cwd());
  const file = findPlanFile(cwd);
  if (!file) return null;

  let plan: PlanDoc;
  try {
    plan = JSON.parse(readFileSync(file, 'utf8')) as PlanDoc;
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('not an object');
  } catch {
    return 'DRIVER: plan.json is unreadable; refusing to run agents (fail closed).';
  }
  if (!input) return 'DRIVER: hook input is not valid JSON; refusing (fail closed).';

  const text = String(firstPresent(input.tool_input?.prompt, input.tool_input?.description, input.tool_input?.message) ?? '');
  const v = gateVerdict(plan, text);
  return v.allow ? null : v.reason;
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/** realpath of the nearest existing ancestor, with the missing tail re-appended. */
function resolveReal(p: string): string {
  let cur = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Returns a deny reason, or null to allow. */
export function protectPlan(input: HookInput | undefined): string | null {
  if (!input) return null;
  // Projects without a DRIVER plan are none of this guard's business.
  if (!findPlanFile(path.resolve(input.cwd ?? process.cwd()))) return null;
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  if (FILE_TOOLS.has(tool) && typeof ti.file_path === 'string') {
    const cwd = path.resolve(input.cwd ?? process.cwd());
    const abs = path.resolve(cwd, ti.file_path);
    const direct = protectPath(abs);
    if (direct) return direct;
    // symlinks and case aliases: compare real locations
    const real = resolveReal(abs);
    const roots = [process.env.DRIVER_ROOT, resolveProjectRoot(cwd), cwd].filter((r): r is string => !!r);
    for (const r of roots) {
      const reason = protectPath(abs, { realPath: real, driverDir: resolveReal(driverDirOf(r)) });
      if (reason) return reason;
    }
  }
  if (tool === 'Bash') return protectCommand(typeof ti.command === 'string' ? ti.command : '');
  return null;
}
