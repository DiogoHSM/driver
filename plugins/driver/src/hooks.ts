import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

const MARKER = /DRIVER-BLOCK:\s*(B-\d+)/;

/** Same semantics as hooks/gate-check.sh. Returns a deny reason, or null to allow. */
export function gateCheck(input: HookInput | undefined): string | null {
  const cwd = path.resolve(input?.cwd ?? process.cwd());
  const file = findPlanFile(cwd);
  if (!file) return null;

  let plan: any;
  try {
    plan = JSON.parse(readFileSync(file, 'utf8'));
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('not an object');
  } catch {
    return 'DRIVER: plan.json is unreadable; refusing to run agents (fail closed).';
  }
  if (!input) return 'DRIVER: hook input is not valid JSON; refusing (fail closed).';

  const text = String(firstPresent(input.tool_input?.prompt, input.tool_input?.description) ?? '');
  const blockId = MARKER.exec(text)?.[1];
  const block = blockId ? plan.blocks?.[blockId] : undefined;
  const phase = block && typeof block === 'object' ? (block.phase ?? null) : (plan.currentPhase ?? null);
  const where = block ? `block ${blockId} (${phase})` : `current phase (${phase})`;

  if (phase !== 'discover' && plan.gates?.route?.approved !== true)
    return `DRIVER: gate route is not approved; ${where} cannot run agents. Ask the user to run, in their own terminal: driver gate approve route`;
  if (phase === 'release' && plan.gates?.release?.approved !== true)
    return `DRIVER: gate release is not approved; ${where} cannot run agents. Ask the user to run, in their own terminal: driver gate approve release`;
  return null;
}

const PROTECTED_FILE = /(^|\/)\.claude\/driver\/(plan\.json|events\.jsonl|log\/[^/]+\.jsonl)$/;
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

const MSG_FILES =
  'DRIVER: plan.json, events.jsonl and log/*.jsonl are written only by the driver CLI. Use "driver block|req|phase ..." instead of editing them.';
const MSG_PTY =
  'DRIVER: pseudo-terminal wrappers are not allowed; user-only actions must be run by the user in their own terminal';
const MSG_USER_ONLY =
  'DRIVER: gate approval, rebaseline and --force are user-only. Ask the user to run them in their own terminal.';

// A driver invocation: `driver` as a command word (not a path segment) or any cli.js.
const DRIVER_TOKEN = /(?:^|[\s;&|(])driver\b|cli\.js/;
const PROTECTED_DIR = /\.claude\/driver/;
const INLINE_INTERPRETER: Record<string, string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  perl: ['-e'],
  ruby: ['-e'],
};
const WRITE_VERBS = new Set(['rm', 'tee', 'truncate', 'dd', 'sponge']);

/** Quotes and backslashes removed, whitespace collapsed, `./` and `//` folded. */
export function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/['"\\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
}

const PTY_COMMANDS = new Set(['script', 'expect', 'unbuffer', 'socat']);

/** Any pty wrapper defeats the /dev/tty confirmation, so it is denied even for unrelated commands. */
function usesPty(norm: string): boolean {
  if (/\bpty\.spawn\b|\bos\.openpty\b|\bforkpty\b/.test(norm)) return true;
  return commandWords(norm).some((w) => PTY_COMMANDS.has(baseName(w[0]!)));
}

/** One entry per simple command: words with leading env assignments and wrappers dropped. */
function commandWords(norm: string): string[][] {
  return norm
    .split(/&&|\|\||[;&|\n]/)
    .map((seg) => seg.trim().split(' ').filter(Boolean))
    .map((w) => {
      let i = 0;
      while (i < w.length && (/^\w+=/.test(w[i]!) || ['sudo', 'command', 'env', 'exec', 'nohup', 'time', 'nice', 'stdbuf'].includes(w[i]!))) i++;
      return w.slice(i);
    })
    .filter((w) => w.length > 0);
}

const baseName = (w: string): string => w.slice(w.lastIndexOf('/') + 1);

function writesDriverDir(norm: string): boolean {
  // a glob near ".claude/dr" can expand to the driver dir, so it counts as a reference
  const globRef = /\.claude\/[^\s/]*[*?[]|\.cl[^\s/]*[*?[][^\s/]*\/dr/.test(norm);
  if (!PROTECTED_DIR.test(norm) && !globRef) return false;
  // redirects, ignoring fd duplication and /dev/null
  const redirects = norm.replace(/\d*>&\d+/g, '').replace(/\d*>>?\s*\/dev\/null/g, '');
  if (redirects.includes('>')) return true;
  for (const w of commandWords(norm)) {
    const cmd = baseName(w[0]!);
    const args = w.slice(1);
    if (WRITE_VERBS.has(cmd)) return true;
    if (cmd === 'sed' && args.some((a) => a === '--in-place' || /^-[A-Za-z]*i/.test(a))) return true;
    if (cmd === 'git' && args.some((a) => a === 'checkout' || a === 'restore')) return true;
    if (INLINE_INTERPRETER[cmd]?.some((f) => args.includes(f))) return true;
    if (cmd === 'mv' || cmd === 'cp' || cmd === 'ln' || cmd === 'rsync') {
      const paths = args.filter((a) => !a.startsWith('-'));
      const last = paths[paths.length - 1] ?? '';
      if (globRef || PROTECTED_DIR.test(last) || /^(plan\.json|events\.jsonl|REL-\d+\.jsonl)$/.test(baseName(last))) return true;
    }
  }
  return false;
}

/** Returns a deny reason, or null to allow. */
export function protectPlan(input: HookInput | undefined): string | null {
  if (!input) return null;
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  if (FILE_TOOLS.has(tool)) {
    const file = typeof ti.file_path === 'string' ? path.posix.normalize(ti.file_path.replace(/\\/g, '/')) : '';
    if (PROTECTED_FILE.test(file)) return MSG_FILES;
  }
  if (tool === 'Bash') {
    const norm = normalizeCommand(typeof ti.command === 'string' ? ti.command : '');
    if (DRIVER_TOKEN.test(norm)) {
      if (/(?:(?:^|[\s;&|(])driver\b|cli\.js)[^]*(?:\bgate approve\b|\brebaseline\b|\s--force\b)/.test(norm))
        return MSG_USER_ONLY;
      if (/[$`]/.test(norm)) return MSG_USER_ONLY;
    }
    if (usesPty(norm)) return MSG_PTY;
    if (writesDriverDir(norm)) return MSG_FILES;
  }
  return null;
}
