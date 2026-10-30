// Pure rules for "who may touch .claude/driver". No node:* imports: the mod runs this too.

export const MSG_FILES =
  'DRIVER: plan.json, events.jsonl, log/*.jsonl and .mod/* are written only by the driver CLI. Use "driver block|req|phase ..." instead of editing them.';
export const MSG_PTY =
  'DRIVER: pseudo-terminal wrappers are not allowed; user-only actions must be run by the user in their own terminal';
export const MSG_GIT = 'DRIVER: this git command can rewrite .claude/driver; use the driver CLI or ask the user.';
export const MSG_USER_ONLY =
  'DRIVER: gate approval, rebaseline and --force are user-only. Ask the user to run them in their own terminal.';

/** What inside the driver dir is protected, relative to it, lower-cased. */
const PROTECTED_REL = /^(plan\.json|events\.jsonl|log\/.*|\.mod\/.*)$/;
const PROTECTED_ABS = /(^|\/)\.claude\/driver\/(plan\.json|events\.jsonl|log\/.*|\.mod\/.*)$/;

/** Folds `.`, `..`, `//` and backslashes. Relative paths keep leading `..`. */
export function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/');
  const abs = s.startsWith('/');
  const out: string[] = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

/**
 * Deny reason for a Write/Edit target, or null. Case-insensitive (APFS aliases).
 * With `realPath` (symlinks resolved by the caller) and `driverDir` (also resolved) it
 * additionally tests that the real location is inside the driver dir.
 */
export function protectPath(filePath: string, opts: { realPath?: string; driverDir?: string } = {}): string | null {
  if (!filePath) return null;
  if (PROTECTED_ABS.test(normalizePath(filePath).toLowerCase())) return MSG_FILES;
  if (opts.realPath && opts.driverDir) {
    const real = normalizePath(opts.realPath).toLowerCase();
    const dir = normalizePath(opts.driverDir).toLowerCase().replace(/\/+$/, '');
    if (real.startsWith(`${dir}/`) && PROTECTED_REL.test(real.slice(dir.length + 1))) return MSG_FILES;
  }
  return null;
}

/** Quotes and backslashes removed, whitespace collapsed, `./` and `//` folded. */
export function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/['"\\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
}

const baseName = (w: string): string => w.slice(w.lastIndexOf('/') + 1);

const WRAPPERS = ['sudo', 'command', 'env', 'exec', 'nohup', 'time', 'nice', 'stdbuf'];
const LAUNCHERS = new Set(['node', 'nodejs', 'bun', 'deno', 'npx', 'pnpm', 'yarn', 'npm', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'xargs', 'eval', 'tsx']);
const PTY_COMMANDS = new Set(['script', 'expect', 'unbuffer', 'socat']);
const INLINE_INTERPRETER: Record<string, string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  perl: ['-e'],
  ruby: ['-e'],
};
const XARGS_WITH_VALUE = new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E', '-a', '-J', '--max-args', '--max-procs', '--delimiter', '--arg-file']);
const GIT_WRITES = new Set(['reset', 'checkout', 'restore', 'stash', 'clean', 'mv', 'rm', 'apply', 'am', 'merge', 'rebase', 'cherry-pick', 'pull', 'switch']);
const PROTECTED_NAMES = ['.claude', 'driver', '.mod', 'plan.json', 'events.jsonl', 'ticket.json', 'rel-1.jsonl', 'log'];
const PROTECTED_MENTION = /plan\.json|events\.jsonl|ticket\.json|rel-\d+\.jsonl|\.mod(\/|$|\s)|\.claude\/driver(\/|$|\s)/i;

/** One entry per simple command: words with leading env assignments and wrappers dropped. */
function commandWords(norm: string): string[][] {
  return norm
    .split(/&&|\|\||[;&|\n]/)
    .map((seg) => seg.trim().split(' ').filter(Boolean))
    .map((w) => {
      let i = 0;
      for (;;) {
        while (i < w.length && (/^\w+=/.test(w[i]!) || WRAPPERS.includes(w[i]!))) i++;
        if (baseName(w[i] ?? '') !== 'xargs') break;
        // xargs runs the wrapped command: judge that, not the wrapper and its options
        i++;
        while (i < w.length && w[i]!.startsWith('-')) i += XARGS_WITH_VALUE.has(w[i]!) ? 2 : 1;
      }
      return w.slice(i);
    })
    .filter((w) => w.length > 0);
}

/** Any pty wrapper defeats the /dev/tty confirmation, so it is denied even for unrelated commands. */
export function usesPty(command: string): boolean {
  const norm = normalizeCommand(command);
  if (/\bpty\.spawn\b|\bos\.openpty\b|\bforkpty\b/.test(norm)) return true;
  return commandWords(norm).some((w) => PTY_COMMANDS.has(baseName(w[0]!)));
}

// ---------------------------------------------------------------- protected targets

const hasGlob = (t: string): boolean => /[*?[]/.test(t);

function globToRegExp(seg: string): RegExp {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = seg.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        re += `[${seg.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const isProtectedBase = (b: string): boolean => b === 'plan.json' || b === 'events.jsonl' || b === 'ticket.json' || /^rel-\d+\.jsonl$/.test(b);

interface Ctx {
  /** The command mentions `.claude` or `cd`: globs there may stand for protected names. */
  globRisk: boolean;
  /** Some `cd` goes into (or toward) the driver dir. */
  cdProtected: boolean;
}

/** Whether a path-like token names (or may expand to) something only the CLI may write. */
function isProtectedToken(raw: string, ctx: Ctx): boolean {
  const eq = /^(?:--?[\w-]+|[a-z]+)=(.*)$/i.exec(raw);
  const tok = normalizePath(eq ? eq[1]! : raw).toLowerCase();
  if (!tok) return false;
  const segs = tok.split('/').filter(Boolean);
  if (segs.length === 0) return false;
  if (segs.includes('.mod') || isProtectedBase(segs[segs.length - 1]!)) return true;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] !== '.claude') continue;
    if (i === segs.length - 1) return true; // the .claude dir itself
    if (segs[i + 1] === 'driver') {
      const rest = segs.slice(i + 2);
      if (rest.length === 0 || rest[0] === 'log') return true;
    }
  }
  if (hasGlob(tok) && ctx.globRisk) {
    return segs.some((seg) => {
      if (!hasGlob(seg)) return false;
      if (/^\*+$/.test(seg)) return ctx.cdProtected || segs.some((x) => x === '.claude' || x === 'driver');
      const re = globToRegExp(seg);
      return PROTECTED_NAMES.some((n) => re.test(n));
    });
  }
  return false;
}

const unaryFlag = (a: string): boolean => a.startsWith('-');

/** Does this simple command write a protected target? */
function writesProtected(w: string[], ctx: Ctx): boolean {
  const cmd = baseName(w[0]!);
  const args = w.slice(1);
  const prot = (t: string): boolean => isProtectedToken(t, ctx);
  const files = args.filter((a) => !unaryFlag(a));
  const noOperand = files.every((a) => a === '.' || a === '..' || hasGlob(a)) ;
  const anyProt = args.some(prot);

  const inline = INLINE_INTERPRETER[cmd];
  if (inline?.some((f) => args.includes(f)) && (PROTECTED_MENTION.test(w.join(' ')) || ctx.cdProtected)) return true;

  if (['rm', 'tee', 'truncate', 'sponge', 'shred', 'unlink', 'dd', 'patch', 'install'].includes(cmd))
    return anyProt || (ctx.cdProtected && (cmd === 'rm' || cmd === 'patch') && noOperand);
  if (cmd === 'cp' || cmd === 'rsync' || cmd === 'ln' || cmd === 'mv') {
    const dest = files[files.length - 1] ?? '';
    return prot(dest) || (cmd === 'mv' && files.slice(0, -1).some(prot)) || (ctx.cdProtected && noOperand);
  }
  if (cmd === 'unzip') return anyProt || (ctx.cdProtected && !args.includes('-l'));
  if (cmd === 'tar') {
    const extract = args.some((a) => /^-?[a-zA-Z]*x[a-zA-Z]*$/.test(a) && !a.startsWith('--')) || args.includes('--extract');
    return extract && (anyProt || ctx.cdProtected);
  }
  if (cmd === 'sed') return (args.some((a) => a === '--in-place' || /^-[A-Za-z]*i/.test(a))) && (anyProt || ctx.cdProtected);
  if (cmd === 'perl' || cmd === 'ruby') return args.some((a) => /^-[A-Za-z]*i/.test(a)) && (anyProt || ctx.cdProtected);
  if (cmd === 'awk' || cmd === 'gawk') return args.includes('inplace') && (anyProt || ctx.cdProtected);
  if (cmd === 'find') return args.some((a) => ['-delete', '-exec', '-execdir', '-ok'].includes(a)) && (anyProt || ctx.cdProtected);
  if (cmd === 'git') {
    const sub = files[0];
    return sub !== undefined && GIT_WRITES.has(sub) && (anyProt || (ctx.cdProtected && noOperand));
  }
  return false;
}

/** Redirect targets (`>`, `>>`, `2>`), ignoring fd duplication and /dev/null. */
function redirectTargets(norm: string): string[] {
  const clean = norm.replace(/\d*>&\d+/g, '').replace(/\d*>>?\s*\/dev\/null/g, '');
  return [...clean.matchAll(/\d*>>?\|?\s*([^\s<>|&;()]+)/g)].map((m) => m[1]!);
}

function writesDriverDir(norm: string): boolean {
  const words = commandWords(norm);
  const globRisk = /\.claude/i.test(norm) || words.some((w) => baseName(w[0]!) === 'cd');
  const ctx: Ctx = { globRisk, cdProtected: false };
  ctx.cdProtected = words.some((w) => baseName(w[0]!) === 'cd' && w.slice(1).some((a) => !unaryFlag(a) && isProtectedToken(a, { ...ctx, cdProtected: true })));
  // the segment text is re-split per simple command so each redirect is judged on its own
  for (const seg of norm.split(/&&|\|\||[;&|\n]/)) {
    if (redirectTargets(seg).some((t) => isProtectedToken(t, ctx))) return true;
  }
  return words.some((w) => writesProtected(w, ctx));
}

// ---------------------------------------------------------------- user-only actions

const isCliJs = (t: string): boolean => {
  if (baseName(t) !== 'cli.js') return false;
  return !t.includes('/') || /(^|\/)dist\/cli\.js$/.test(t) || /driver/.test(t);
};
const isDriverToken = (t: string): boolean => baseName(t) === 'driver' || isCliJs(t);

/** A simple command that runs the driver CLI (or hands it to a shell or launcher). */
function isDriverInvocation(w: string[]): boolean {
  const first = baseName(w[0]!);
  if (first === 'driver' || isCliJs(w[0]!)) return true;
  if (/[$`(]/.test(w[0]!)) return true;
  return LAUNCHERS.has(first) && w.slice(1).some(isDriverToken);
}

function userOnlyAction(w: string[]): boolean {
  const toks = new Set(w.map((t) => (t.startsWith('--') && t.includes('=') ? t.slice(0, t.indexOf('=')) : t)));
  if (toks.has('rebaseline') || toks.has('via-mod') || toks.has('--via-mod') || toks.has('--force') || toks.has('-f')) return true;
  if (toks.has('gate') && toks.has('approve')) return true;
  for (let i = 0; i < w.length; i++) {
    const t = w[i]!;
    if (t === '--actor' && /^user:/i.test(w[i + 1] ?? '')) return true;
    if (/^--actor=user:/i.test(t)) return true;
  }
  return false;
}

const STASH_READS = new Set(['list', 'show']);

/** git commands that can rewrite the whole working tree, plan.json included. */
function rewritesWorkingTree(norm: string): boolean {
  for (const w of commandWords(norm)) {
    if (baseName(w[0]!) !== 'git') continue;
    const rest = w.slice(1);
    let at = 0;
    while (at < rest.length && rest[at]!.startsWith('-')) at += ['-C', '-c', '--git-dir', '--work-tree'].includes(rest[at]!) ? 2 : 1;
    const sub = rest[at];
    const after = rest.slice(at + 1);
    if (sub === 'reset' && after.includes('--hard')) return true;
    if (sub === 'checkout-index' || sub === 'update-index' || sub === 'read-tree') return true;
    if (sub === 'stash' && !STASH_READS.has(after.find((a) => !a.startsWith('-')) ?? '')) return true;
  }
  return false;
}

/** Deny reason for a Bash command, or null. Callers apply it only where a DRIVER plan exists. */
export function protectCommand(command: string): string | null {
  const norm = normalizeCommand(command);
  if (/via-mod/i.test(norm)) return MSG_USER_ONLY;
  for (const w of commandWords(norm)) {
    if (!isDriverInvocation(w)) continue;
    if (userOnlyAction(w)) return MSG_USER_ONLY;
    if (/[$`]/.test(w.join(' '))) return MSG_USER_ONLY;
  }
  if (usesPty(norm)) return MSG_PTY;
  if (writesDriverDir(norm)) return MSG_FILES;
  if (rewritesWorkingTree(norm)) return MSG_GIT;
  return null;
}
