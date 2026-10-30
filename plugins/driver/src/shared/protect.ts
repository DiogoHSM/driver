// Pure rules for "who may touch .claude/driver". No node:* imports: the mod runs this too.

export const MSG_FILES =
  'DRIVER: plan.json, events.jsonl, log/*.jsonl and .mod/* are written only by the driver CLI. Use "driver block|req|phase ..." instead of editing them.';
export const MSG_PTY =
  'DRIVER: pseudo-terminal wrappers are not allowed; user-only actions must be run by the user in their own terminal';
export const MSG_GIT = 'DRIVER: this git command can rewrite .claude/driver; use the driver CLI or ask the user.';
export const MSG_USER_ONLY =
  'DRIVER: gate approval, rebaseline and --force are user-only. Ask the user to run them in their own terminal.';
export const MSG_SUBST =
  'DRIVER: a command whose name comes from a substitution or a variable cannot be checked. Write the command literally.';
export const MSG_SCRIPT =
  'DRIVER: this inline script mentions .claude/driver files and the guard cannot tell whether it writes them. Use the Write/Edit tools or the driver CLI instead.';

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

// ---------------------------------------------------------------- shell scanning

const CODE = 0;
const SQ = 1;
const DQ = 2;
const COMMENT = 3;
const ARITH = 4;
/** A character escaped by a backslash: text, never an operator. */
const ESC = 5;
/** Inside `${ … }`: text, no comment and no heredoc can start here. */
const PARAM = 6;
/** Code inside `$( … )`: like CODE, but a heredoc opened here may end at `EOF)`. */
const SUBCODE = 7;
/** Inside `[[ … ]]`: `|` and `&&` are operators of the test, not of the shell. */
const TEST = 8;

const isCode = (s: number): boolean => s === CODE || s === SUBCODE;
const SEP_BEFORE_COMMENT = /[\s;&|(]/;
/** Keywords after which `((` opens arithmetic even without a space: `for((`, `while((`. */
const ARITH_KEYWORD = /(^|\s)(for|while|until|if|elif)$/;

// separators that are text where they stand (quotes, `[[ ]]`, `(( ))`, `${ }`) are swapped for
// private-use characters so that `commandWords` does not split on them; `restoreSeparators` undoes it
const SEP_SWAP: Record<string, string> = { '|': '', ';': '', '&': '', ' ': '', '\t': '' };
const SWAPPED = /[-]/;
const restoreSeparators = (s: string): string => s.replace(//g, '|').replace(//g, ';').replace(//g, '&').replace(//g, ' ');
/** The text before a `[[` that makes it the command word: start, a separator, a group opener or a keyword. */
const COMMAND_POSITION = /(^|[;&|({!]|\b(?:if|then|else|elif|while|until|do))\s*$/;

/**
 * Classifies each character of a shell command as code, single-quoted, double-quoted, comment or
 * arithmetic (`$(( … ))`, `(( … ))`, where `<<` is a shift). Fed one line at a time; quote and
 * substitution state carries over to the next line, a comment ends with its line. `"$( … )"`
 * reopens a code context inside double quotes (`git commit -m "$(cat <<'EOF' …`).
 */
class ShellScanner {
  private sq = false;
  /** `$'…'`: a backslash escapes inside the single quotes. */
  private ansi = false;
  private dq = false;
  private readonly subst: boolean[] = [];
  /** Open parens of `$(( … ))` / `(( … ))`, or -1 while inside `$[ … ]` or a subscript `a[ … ]`. */
  private arith = 0;
  private param = 0;
  /** The `${ … }` was opened inside double quotes, where a single quote is text. */
  private paramInDq = false;
  private test = false;
  /** The last line ended with an unescaped backslash: the line break continues the command. */
  continues = false;

  get inQuotes(): boolean {
    return this.sq || this.dq;
  }

  feed(line: string): Uint8Array {
    const st = new Uint8Array(line.length);
    const code = (): number => (this.subst.length > 0 ? SUBCODE : CODE);
    this.continues = false;
    // `[[ … ]]` and a subscript never span lines
    this.test = false;
    if (this.arith < 0) this.arith = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (this.arith !== 0) {
        if (this.arith < 0) {
          // a subscript ends at `]`, and a separator ends it too (bash would not run the rest otherwise)
          if (c === ']') this.arith = 0;
          else if (/[;&|]/.test(c)) {
            this.arith = 0;
            st[i] = code();
            continue;
          }
          st[i] = ARITH;
          continue;
        }
        st[i] = ARITH;
        if (c === '(') this.arith++;
        else if (c === ')') this.arith--;
        continue;
      }
      if (this.sq) {
        st[i] = SQ;
        if (this.ansi && c === '\\' && i + 1 < line.length) st[++i] = SQ;
        else if (c === "'") this.sq = this.ansi = false;
        continue;
      }
      if (this.param > 0) {
        st[i] = PARAM;
        if (c === '{') this.param++;
        else if (c === '}') this.param--;
        else if ((c === "'" && !this.paramInDq) || c === '"') {
          // a quoted string inside `${ … }`: its braces and quotes are text
          for (i++; i < line.length && line[i] !== c; i++) {
            st[i] = PARAM;
            if (c === '"' && line[i] === '\\') st[++i] = PARAM;
          }
          if (i < line.length) st[i] = PARAM;
        }
        continue;
      }
      if (this.test) {
        if (c === ';') {
          this.test = false;
          st[i] = code();
          continue;
        }
        st[i] = TEST;
        if (c === ']' && line[i + 1] === ']') {
          st[++i] = TEST;
          this.test = false;
        }
        continue;
      }
      if (c === '\\') {
        st[i] = this.dq ? DQ : code();
        if (i + 1 < line.length) st[++i] = ESC;
        else this.continues = true;
        continue;
      }
      if (c === '$' && line[i + 1] === '(') {
        if (line[i + 2] === '(') {
          st[i] = st[i + 1] = st[i + 2] = ARITH;
          this.arith = 2;
          i += 2;
          continue;
        }
        this.subst.push(this.dq);
        this.dq = false;
        st[i] = st[i + 1] = SUBCODE;
        i++;
        continue;
      }
      if (c === '$' && line[i + 1] === '{') {
        st[i] = st[i + 1] = PARAM;
        this.param = 1;
        this.paramInDq = this.dq;
        i++;
        continue;
      }
      if (c === '$' && line[i + 1] === '[' && !this.dq) {
        st[i] = st[i + 1] = ARITH;
        this.arith = -1;
        i++;
        continue;
      }
      if (this.dq) {
        st[i] = DQ;
        if (c === '"') this.dq = false;
        continue;
      }
      if (c === "'") {
        this.sq = true;
        this.ansi = line[i - 1] === '$' && st[i - 1] !== ESC;
        st[i] = SQ;
        continue;
      }
      if (c === '"') {
        this.dq = true;
        st[i] = DQ;
        continue;
      }
      if (c === ')' && this.subst.length > 0) {
        this.dq = this.subst.pop()!;
        st[i] = code();
        continue;
      }
      if (c === '(' && line[i + 1] === '(' && (i === 0 || !/\w/.test(line[i - 1]!) || ARITH_KEYWORD.test(line.slice(0, i)))) {
        st[i] = st[i + 1] = ARITH;
        this.arith = 2;
        i++;
        continue;
      }
      // `a[1<<2]=3`: the subscript of an assignment at the start of a word is arithmetic
      if (c === '[' && i > 0 && /\w/.test(line[i - 1]!) && isCode(st[i - 1]!)) {
        let s = i - 1;
        while (s > 0 && /\w/.test(line[s - 1]!)) s--;
        const close = line.indexOf(']', i);
        if ((s === 0 || /[\s;&|(]/.test(line[s - 1]!)) && close > 0 && /^\+?=/.test(line.slice(close + 1, close + 3))) {
          st[i] = ARITH;
          this.arith = -1;
          continue;
        }
      }
      // `[[ … ]]` only as the command word; elsewhere `[[` is a plain (broken) argument
      if (c === '[' && line[i + 1] === '[' && COMMAND_POSITION.test(line.slice(0, i))) {
        st[i] = st[i + 1] = TEST;
        this.test = true;
        i++;
        continue;
      }
      if (c === '#' && (i === 0 || (isCode(st[i - 1]!) && SEP_BEFORE_COMMENT.test(line[i - 1]!)))) {
        for (; i < line.length; i++) st[i] = COMMENT;
        break;
      }
      st[i] = code();
    }
    return st;
  }
}

/** Whether the shell would expand a `$` or a backtick anywhere in the text (outside single quotes). */
function hasExpansion(text: string): boolean {
  const sc = new ShellScanner();
  for (const line of text.split('\n')) {
    const st = sc.feed(line);
    for (let i = 0; i < line.length; i++) {
      if ((line[i] === '$' || line[i] === '`') && (isCode(st[i]!) || st[i] === DQ || st[i] === PARAM || st[i] === ARITH)) return true;
    }
  }
  return false;
}

/**
 * Quotes, backslashes and comments removed, whitespace collapsed, `./` and `//` folded. A line
 * break outside quotes ends a command like `;` does; inside quotes, or after a backslash, it is
 * part of the same command.
 */
export function normalizeCommand(cmd: string): string {
  const sc = new ShellScanner();
  let out = '';
  for (const raw of cmd.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const st = sc.feed(line);
    let kept = '';
    for (let i = 0; i < line.length; i++) {
      const s = st[i]!;
      if (s === COMMENT) continue;
      const c = line[i]!;
      // inside quotes a blank is part of the word too, so quoted code stays one argument
      const swap = (s === SQ || s === DQ) ? c in SEP_SWAP : !isCode(s) && s !== ESC && c in SEP_SWAP && c !== ' ' && c !== '\t';
      kept += swap ? SEP_SWAP[c]! : c;
    }
    out += kept + (sc.continues ? ' ' : sc.inQuotes ? ' ' : ' ; ');
  }
  return out
    .replace(/['"\\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/(\s*;)+\s*$/, '')
    .trim();
}

const baseName = (w: string): string => w.slice(w.lastIndexOf('/') + 1);

const WRAPPERS = ['sudo', 'command', 'env', 'exec', 'nohup', 'time', 'nice', 'stdbuf', 'timeout', 'coproc', 'noglob', 'nocorrect', 'builtin'];
/** Wrapper options that take a value, so the value is not the wrapped command (`env -i` takes none). */
const WRAPPER_WITH_VALUE = new Set(['-n', '-u', '-C', '-P', '-S', '-k', '-s', '-a', '-g', '-h', '--signal', '--kill-after']);
/** Shell keywords in front of a command: `if driver …`, `do $cmd`, `! driver …`. */
const KEYWORDS = ['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'esac', '!'];
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

/** One entry per simple command: words with leading env assignments, wrappers and grouping parens dropped. */
function commandWords(norm: string): string[][] {
  return norm
    .split(/&&|\|\||[;&|\n]/)
    .map((seg) => seg.trim())
    // `(( x > 1 ))`, `if (( $x > 1 ))`: arithmetic, not a command
    .filter((seg) => !seg.replace(/^(?:(?:if|then|else|elif|while|until|do|!)\s+)+/, '').startsWith('(('))
    .map((seg) => seg.split(' ').filter((t) => t !== '' && !/^[()]+$|^[{}]$/.test(t)))
    .map((w) => {
      let i = 0;
      for (;;) {
        for (;;) {
          // `(driver gate approve route)`, `f() (driver …)`: the same command in a subshell
          if (i < w.length) w[i] = w[i]!.replace(/^\(+/, '');
          const t = w[i] ?? '';
          if (t === '') {
            if (i < w.length) i++;
            else break;
          } else if (/^\w+(\[[^\]]*\])?\+?=/.test(t) || KEYWORDS.includes(t)) i++;
          else if (t === 'case') i += 3; // `case WORD in`
          else if (/^[^()\s]+\)$/.test(t)) i++; // a case pattern: `x)`, `(x)`, `"$y")`, `*)` (the paren was stripped above)
          else if (/^\w+\(\)\{?$/.test(t)) i++; // `f() { … }`, `f(){ … }`
          else if (t === 'function') i += 2;
          else if (WRAPPERS.includes(baseName(t))) {
            i++;
            while (i < w.length && w[i]!.startsWith('-')) i += WRAPPER_WITH_VALUE.has(w[i]!) ? 2 : 1;
            if (baseName(t) === 'timeout' && i < w.length) i++; // the duration
          } else break;
        }
        if (baseName(w[i] ?? '') !== 'xargs') break;
        // xargs runs the wrapped command: judge that, not the wrapper and its options
        i++;
        while (i < w.length && w[i]!.startsWith('-')) i += XARGS_WITH_VALUE.has(w[i]!) ? 2 : 1;
      }
      return w.slice(i);
    })
    .filter((w) => w.length > 0 && w[0] !== '');
}

const PTY_API = /\bpty\.spawn\b|\bos\.openpty\b|\bforkpty\b/;

/** Any pty wrapper defeats the /dev/tty confirmation, so it is denied even for unrelated commands. */
export function usesPty(command: string): boolean {
  const norm = normalizeCommand(command);
  if (PTY_API.test(norm)) return true;
  return commandWords(norm).some((w) => PTY_COMMANDS.has(baseName(w[0]!)));
}

// ---------------------------------------------------------------- heredocs

export interface Heredoc {
  /** The logical line that opens the heredoc, plus the line that reads it when the opener ends in a pipe. */
  cmd: string;
  body: string;
  /** Quoted delimiter (`<<'EOF'`, `<<"EOF"`, `<<\EOF`): the shell expands nothing in the body. */
  quoted: boolean;
}

interface HeredocOpen {
  delim: string;
  quoted: boolean;
  /** `<<-`: leading tabs are stripped before the terminator is compared. */
  strip: boolean;
  /** Opened inside `$( … )`: bash also accepts `EOF)` as the terminator. */
  inSubst: boolean;
}

const DQ_ESCAPABLE = new Set(['$', '`', '"', '\\']);

/**
 * Heredoc openers on one line, in order: `<<`, optional `-`, then the delimiter word with its
 * quotes removed (`'EOF'`, `E"OF"`, `\EOF` all mean `EOF` and mark the body as not expanded).
 * A `<<` inside quotes, in a comment or in arithmetic is text, so what follows the line stays
 * commands. `<<<` is a here-string, not a heredoc.
 */
function heredocOpens(line: string, st: Uint8Array): HeredocOpen[] {
  const out: HeredocOpen[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!isCode(st[i]!) || line[i] !== '<' || line[i + 1] !== '<' || line[i + 2] === '<' || line[i - 1] === '<') continue;
    const inSubst = st[i] === SUBCODE;
    let j = i + 2;
    let strip = false;
    if (line[j] === '-') {
      strip = true;
      j++;
    }
    while (line[j] === ' ' || line[j] === '\t') j++;
    let delim = '';
    let quoted = false;
    for (; j < line.length; j++) {
      const c = line[j]!;
      if (st[j] === ESC) {
        quoted = true;
        delim += c;
      } else if (st[j] === SQ) {
        quoted = true;
        if (c !== "'") delim += c;
      } else if (st[j] === DQ) {
        quoted = true;
        // inside double quotes a backslash is kept unless it escapes $ ` " or \
        if (c === '\\' && DQ_ESCAPABLE.has(line[j + 1] ?? '')) continue;
        if (c !== '"') delim += c;
      } else if (!isCode(st[j]!) || /[\s<>|&;()]/.test(c)) break;
      else if (c === '$' && (line[j + 1] === "'" || line[j + 1] === '"')) continue; // `$'EOF'`: quote removal drops the $
      else if (c !== '\\') delim += c;
    }
    if (delim !== '') out.push({ delim, quoted, strip, inSubst });
    i = j - 1;
  }
  return out;
}

/**
 * Takes heredoc bodies out of a command. The shell never runs a body as commands: it is the
 * stdin of the command that opens it, so it is judged by that command (see `protectHeredoc`).
 * Body lines are not fed to the scanner, so a quote inside a body does not change how the
 * lines after it are read.
 */
export function extractHeredocs(command: string): { text: string; docs: Heredoc[] } {
  const lines = command.split('\n');
  const text: string[] = [];
  const docs: Heredoc[] = [];
  const sc = new ShellScanner();
  // openers wait until the logical line ends: `cat <<'EOF' \` + `| bash` is one command
  let pending: HeredocOpen[] = [];
  let logical: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    text.push(line);
    pending.push(...heredocOpens(line, sc.feed(line)));
    logical.push(line);
    if (sc.continues || pending.length === 0) {
      if (!sc.continues) logical = [];
      continue;
    }
    let j = i + 1;
    const bodies: string[] = [];
    for (const open of pending) {
      const body: string[] = [];
      for (; j < lines.length; j++) {
        const l = open.strip ? lines[j]!.replace(/^\t+/, '') : lines[j]!;
        if (l === open.delim || (open.inSubst && l === `${open.delim})`)) break;
        body.push(lines[j]!);
      }
      bodies.push(body.join('\n'));
      j++; // past the terminator (or the end of an unterminated body)
    }
    let cmd = logical.join(' ');
    // `cat <<'EOF' |` + body + `bash`: the reader is the line after the terminator
    if (/(\||&&)\s*$/.test(normalizeCommand(cmd)) && j < lines.length) cmd += ` ${lines[j]!}`;
    pending.forEach((open, k) => docs.push({ cmd, body: bodies[k]!, quoted: open.quoted }));
    pending = [];
    logical = [];
    i = j - 1;
  }
  return { text: text.join('\n'), docs };
}

/**
 * Inner text of every `$( … )` and `` ` … ` `` the shell would run. In command text single quotes
 * protect them (`shellQuoting`); in an unquoted heredoc body nothing does.
 */
function substitutions(body: string, shellQuoting = false): string[] {
  const out: string[] = [];
  let st: Uint8Array | null = null;
  if (shellQuoting) {
    const sc = new ShellScanner();
    const parts = body.split('\n').map((l) => sc.feed(l));
    st = new Uint8Array(body.length);
    let off = 0;
    for (const p of parts) {
      st.set(p, off);
      off += p.length + 1;
    }
  }
  const literal = (i: number): boolean => st !== null && (st[i] === SQ || st[i] === ESC);
  let tick = body.indexOf('`');
  while (tick >= 0) {
    const end = body.indexOf('`', tick + 1);
    if (end < 0) break;
    if (!literal(tick)) out.push(body.slice(tick + 1, end));
    tick = body.indexOf('`', end + 1);
  }
  // `$( … )` everywhere; `<( … )` and `>( … )` (process substitution) only in command text
  const openers = shellQuoting ? ['$(', '<(', '>('] : ['$('];
  for (const opener of openers) {
    for (let at = body.indexOf(opener); at >= 0; at = body.indexOf(opener, at + 2)) {
      // `\$(` is literal; `$(( … ))` is arithmetic; `<<(` is not an opener
      if (body[at - 1] === '\\' || body[at + 2] === '(' || literal(at) || (opener === '<(' && body[at - 1] === '<')) continue;
      let depth = 0;
      let end = -1;
      for (let k = at + 1; k < body.length; k++) {
        const c = body[k];
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) {
          end = k;
          break;
        }
      }
      out.push(end < 0 ? body.slice(at + 2) : body.slice(at + 2, end));
    }
  }
  return out;
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

function contextOf(norm: string): Ctx {
  const words = commandWords(norm);
  const globRisk = /\.claude/i.test(norm) || words.some((w) => baseName(w[0]!) === 'cd');
  const ctx: Ctx = { globRisk, cdProtected: false };
  ctx.cdProtected = words.some((w) => baseName(w[0]!) === 'cd' && w.slice(1).some((a) => !unaryFlag(a) && isProtectedToken(a, { ...ctx, cdProtected: true })));
  return ctx;
}

function writesDriverDir(norm: string, ctx: Ctx): boolean {
  // the segment text is re-split per simple command so each redirect is judged on its own
  for (const seg of norm.split(/&&|\|\||[;&|\n]/)) {
    if (redirectTargets(seg).some((t) => isProtectedToken(t, ctx))) return true;
  }
  return commandWords(norm).some((w) => writesProtected(w, ctx));
}

/**
 * `node -e`, `python -c` …: a script that names a protected file may write it; the guard cannot
 * tell. The whole command is searched for the name, since a quoted script may span lines.
 */
function inlineScriptMentions(norm: string, ctx: Ctx): boolean {
  const inline = commandWords(norm).some((w) => {
    const flags = INLINE_INTERPRETER[baseName(w[0]!)];
    return flags !== undefined && w.slice(1).some((a) => flags.includes(a));
  });
  return inline && (PROTECTED_MENTION.test(norm) || ctx.cdProtected);
}

// ---------------------------------------------------------------- user-only actions

// case-insensitive: APFS resolves `Driver` and `CLI.JS` to the same files
const isCliJs = (t: string): boolean => {
  const low = t.toLowerCase();
  if (baseName(low) !== 'cli.js') return false;
  return !low.includes('/') || /(^|\/)dist\/cli\.js$/.test(low) || /driver/.test(low);
};
const isDriverToken = (t: string): boolean => baseName(t).toLowerCase() === 'driver' || isCliJs(t);

/** The command name is a substitution or a variable: whatever it runs cannot be read here. */
const isOpaqueName = (t: string): boolean => /[$`]/.test(t);

/** A simple command that runs the driver CLI (or hands it to a shell or launcher), or one whose name is opaque. */
function isDriverInvocation(w: string[]): boolean {
  const first = baseName(w[0]!).toLowerCase();
  if (first === 'driver' || isCliJs(w[0]!)) return true;
  if (isOpaqueName(w[0]!)) return true;
  return LAUNCHERS.has(first) && w.slice(1).some(isDriverToken);
}

function userOnlyAction(w: string[]): boolean {
  const toks = new Set(w.map((t) => t.replace(/\)+$/, '')).map((t) => (t.startsWith('--') && t.includes('=') ? t.slice(0, t.indexOf('=')) : t)));
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

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'parallel']);
/** Builtins that run their input as shell code (`exec` because of `exec 3<<EOF` plus `bash <&3`). */
const RUNS_TEXT = new Set(['eval', 'source', '.', 'exec']);
/** Commands that run a quoted argument as shell code (a blocklist by nature; the ADR records the limit). */
const CODE_RUNNERS = new Set(['eval', 'source', 'su', 'watch', 'xargs', 'ssh', 'nohup', 'timeout', 'env', 'sudo', 'find', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'tmux', 'screen', 'make', 'docker', 'flock', 'caffeinate', 'parallel']);
/** git settings whose value is a shell command: `git -c alias.x='!…'`, `git -c core.sshCommand='…'`. */
const GIT_CODE_SETTING = /^(alias\.[^=]+=!|core\.(sshcommand|pager|editor|hookspath|fsmonitor)=|diff\.external=|credential\.helper=)/i;
const SCRIPT_READERS = new Set([...Object.keys(INLINE_INTERPRETER), 'node', 'nodejs', 'bun', 'deno', 'tsx', 'php', 'osascript']);
/** Readers whose stdin names the files they write. */
const PATCHERS = new Set(['patch']);
const GIT_PATCH = new Set(['apply', 'am']);

/** The command names on a line: each segment's first word, plus `>(cmd)` / `<(cmd)` process substitutions. */
function commandNames(segs: string[][]): string[] {
  const names: string[] = [];
  for (const w of segs) {
    names.push(baseName(w[0]!));
    for (const t of w.slice(1)) if (/^[<>]\(/.test(t)) names.push(baseName(t.slice(2).replace(/\)$/, '')));
  }
  return names;
}

/** Deny reason for one heredoc, judged by the command that reads it. */
function protectHeredoc(d: Heredoc, ctx: Ctx): string | null {
  // the whole line counts: `cat <<EOF | bash` hands the body to bash
  const line = normalizeCommand(d.cmd);
  const segs = commandWords(line);
  const names = commandNames(segs);
  // a shell, eval or source reads the body as commands; so may whoever later reads a numbered fd
  if (names.some((n) => SHELLS.has(n) || RUNS_TEXT.has(n)) || /(^|\s)\d+<<-?/.test(d.cmd)) return protect(d.body, ctx);
  // xargs turns the body into arguments of the command it wraps
  if (/(^|[\s/])xargs(\s|$)/.test(line) && segs.some(isDriverInvocation)) {
    const bodyWords = normalizeCommand(d.body).split(' ').filter(Boolean);
    if (segs.some((w) => isDriverInvocation(w) && userOnlyAction([...w, ...bodyWords]))) return MSG_USER_ONLY;
  }
  if (PTY_API.test(normalizeCommand(d.body))) return MSG_PTY;
  // a patch names the files it rewrites
  if (segs.some((w) => PATCHERS.has(baseName(w[0]!)) || (baseName(w[0]!) === 'git' && GIT_PATCH.has(w[1] ?? ''))) && PROTECTED_MENTION.test(d.body)) return MSG_FILES;
  // an interpreter fed a script that names protected files (the driver CLI itself is the sanctioned writer)
  if (segs.some((w) => SCRIPT_READERS.has(baseName(w[0]!)) && !isDriverInvocation(w)) && (PROTECTED_MENTION.test(d.body) || ctx.cdProtected)) return MSG_SCRIPT;
  if (!d.quoted) {
    // the shell expands `$( … )` and backticks inside an unquoted body before the command sees it
    for (const s of substitutions(d.body)) {
      const reason = protect(s, ctx);
      if (reason) return reason;
    }
  }
  return null;
}

/** Deny reason for a Bash command, or null. Callers apply it only where a DRIVER plan exists. */
export function protectCommand(command: string): string | null {
  return protect(command, null);
}

/** `outer`: the context of the command this text was found in (`cd .claude/driver && bash <<EOF`). */
function protect(command: string, outer: Ctx | null): string | null {
  const { text, docs } = extractHeredocs(command);
  const norm = normalizeCommand(text);
  // raw catches the word inside a heredoc body; normalized catches it broken up by quotes
  if (/via-mod/i.test(command) || /via-mod/i.test(norm)) return MSG_USER_ONLY;
  const expands = hasExpansion(text);
  const segs = commandWords(norm);
  // a quoted argument that holds separators or blanks is code when something on the line runs code:
  // `su -c '…'`, `watch '…'`, `find -exec sh -c '…' \;`, `printf '%s' '…' | sh`, `git -c alias.x='!…'`
  const words = segs.flat();
  if (words.some((t) => SHELLS.has(baseName(t)) || CODE_RUNNERS.has(baseName(t)) || GIT_CODE_SETTING.test(t))) {
    for (const t of words) {
      if (!SWAPPED.test(t)) continue;
      const reason = protect(restoreSeparators(t.replace(GIT_CODE_SETTING, '')), outer);
      if (reason) return reason;
    }
  }
  for (const w of segs) {
    const first = baseName(w[0]!);
    const handsCode = first === 'eval' || (SHELLS.has(first) && w.includes('-c'));
    if (handsCode) {
      // code handed to a shell must be readable here: `eval "$X"`, `bash -c "$X"` (single-quoted code is literal)
      if (expands && w.slice(1).some(isOpaqueName)) return MSG_SUBST;
      // and readable code is judged as the commands it is: `sh -c "cd .claude/driver; rm plan.json"`
      const code = restoreSeparators(w.slice(first === 'eval' ? 1 : w.indexOf('-c') + 1).join(' '));
      const reason = protect(code, outer);
      if (reason) return reason;
    }
    if (!isDriverInvocation(w)) continue;
    if (userOnlyAction(w)) return MSG_USER_ONLY;
    if (isOpaqueName(w[0]!)) return MSG_SUBST;
    // a driver call whose arguments come from substitution may hide a user-only verb
    if (/[$`]/.test(w.join(' '))) return MSG_USER_ONLY;
  }
  if (usesPty(norm)) return MSG_PTY;
  const own = contextOf(norm);
  const ctx: Ctx = outer ? { globRisk: own.globRisk || outer.globRisk, cdProtected: own.cdProtected || outer.cdProtected } : own;
  if (writesDriverDir(norm, ctx)) return MSG_FILES;
  if (inlineScriptMentions(norm, ctx)) return MSG_SCRIPT;
  if (rewritesWorkingTree(norm)) return MSG_GIT;
  // `echo $(driver …)`, `x=$(driver …)`, `cat >(driver …)`: a substitution in argument position runs too
  for (const s of substitutions(text, true)) {
    const reason = protect(s, ctx);
    if (reason) return reason;
  }
  for (const d of docs) {
    const reason = protectHeredoc(d, ctx);
    if (reason) return reason;
  }
  return null;
}
