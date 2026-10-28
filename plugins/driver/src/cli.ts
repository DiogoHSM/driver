import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { denyOutput, findPlanFile, gateCheck, parseHookInput, protectPlan } from './hooks.js';
import { toMermaid } from './mermaid.js';
import { OpRefusedError, PlanInvariantError, type Op } from './reducer.js';
import { replayIssues } from './replay.js';
import {
  BLOCK_STATUSES,
  PHASES,
  PlanV1Schema,
  TEST_LAYERS,
  type Actor,
  type BlockStatus,
  type PhaseId,
  type PlanV1,
  type Provider,
  type TestRef,
} from './schema.js';
import {
  LockTimeoutError,
  NotInitializedError,
  RevisionConflictError,
  driverDirOf,
  initDriverDir,
  mutate,
  readAllEvents,
  readPlan,
  resolveProjectRoot,
} from './store.js';
import { hasErrors, validatePlan, type Issue } from './validate.js';

class UsageError extends Error {}

const HELP = `driver <command> [options]

  init <name> [--packs a,b]
  validate [dir] [--replay]
  status [dir]
  block add <title> --phase <p> [--depends B-001,..] [--req R-001,..] [--provider cap:provider:access] [--credentials A,B] [--risk low|medium|high]
  block set <id> [--title] [--depends] [--req] [--artifacts a,b] [--add-artifact p] [--test ref:layer:result] [--verified true|false] [--provider] [--credentials] [--risk]
  block status <id> <to> [--reason ..] [--owner <platform agent id>] [--force]
  block retire <id> --decision D-001 --reason ..
  block orphan --owner <agentId>
  decision add --title .. [--reason ..]
  req add <title> --kind functional|nonfunctional|constraint|non-goal --source user|assumed [--ref ..] [--doc]
  req retire <id> --decision D-001 --reason ..
  gate approve <route|release> | gate revoke <route|release> --reason ..
  phase advance | phase back <phase> --reason ..
  rebaseline --reason .. [--changed B-001,..] [--decision D-001]
  release add --version V --commit SHA [--blocks B-001,..]
  export mermaid [dir] [--out path] [--stdout]
  renumber
  hook gate-check | protect-plan | subagent-stop     (reads hook JSON on stdin)

gate approve, rebaseline and --force ask for a typed "yes" on /dev/tty (user terminal only).
global: --cwd <dir>  --root <dir>  --actor <kind:id>  --json  --now <iso>
exit codes: 0 ok, 1 validation or transition refused, 2 usage or forbidden`;

const OPTIONS = {
  cwd: { type: 'string' },
  root: { type: 'string' },
  actor: { type: 'string' },
  json: { type: 'boolean' },
  now: { type: 'string' },
  packs: { type: 'string' },
  phase: { type: 'string' },
  depends: { type: 'string' },
  req: { type: 'string' },
  provider: { type: 'string' },
  credentials: { type: 'string' },
  risk: { type: 'string' },
  title: { type: 'string' },
  artifacts: { type: 'string' },
  'add-artifact': { type: 'string', multiple: true },
  test: { type: 'string', multiple: true },
  verified: { type: 'string' },
  reason: { type: 'string' },
  force: { type: 'boolean' },
  decision: { type: 'string' },
  owner: { type: 'string' },
  kind: { type: 'string' },
  source: { type: 'string' },
  ref: { type: 'string' },
  changed: { type: 'string' },
  version: { type: 'string' },
  commit: { type: 'string' },
  blocks: { type: 'string' },
  out: { type: 'string' },
  stdout: { type: 'boolean' },
  replay: { type: 'boolean' },
  doc: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

const list = (s: string | undefined): string[] | undefined =>
  s === undefined ? undefined : s.split(',').map((x) => x.trim()).filter(Boolean);

function need(v: string | undefined, name: string): string {
  if (v === undefined || v === '') throw new UsageError(`missing --${name}`);
  return v;
}

function oneOf<T extends string>(v: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(v)) throw new UsageError(`${name} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

function parseActor(s: string): Actor {
  const i = s.indexOf(':');
  const kind = i < 0 ? s : s.slice(0, i);
  const id = i < 0 ? '' : s.slice(i + 1);
  if (!['model', 'user', 'hook'].includes(kind) || !id) throw new UsageError(`--actor must be <model|user|hook>:<id>, got "${s}"`);
  return { kind: kind as Actor['kind'], id };
}

function parseProvider(spec: string | undefined, creds: string | undefined): Provider | undefined {
  if (spec === undefined) return undefined;
  const [capability, provider, access] = spec.split(':');
  if (!capability || !provider || !access) throw new UsageError('--provider must be capability:provider:access');
  return {
    capability,
    provider,
    access: oneOf(access, ['cli', 'mcp', 'api'] as const, 'provider access'),
    ...(creds ? { credentials: list(creds)! } : {}),
  };
}

function parseTest(spec: string): TestRef {
  const parts = spec.split(':');
  if (parts.length < 3) throw new UsageError('--test must be ref:layer:result');
  const result = parts.pop()!;
  const layer = parts.pop()!;
  return {
    ref: parts.join(':'),
    layer: oneOf(layer, TEST_LAYERS, 'test layer'),
    result: oneOf(result, ['pass', 'fail', 'unknown'] as const, 'test result'),
  };
}

interface Env {
  cwd: string;
  actor: Actor;
  now: string;
  json: boolean;
  flags: Flags;
}

function locateDriverDir(env: Env, dirArg?: string): string {
  if (dirArg) {
    const abs = path.resolve(env.cwd, dirArg);
    return existsSync(path.join(abs, 'plan.json')) ? abs : driverDirOf(abs);
  }
  const root = env.flags.root ?? process.env.DRIVER_ROOT;
  return driverDirOf(root ? path.resolve(env.cwd, root) : resolveProjectRoot(env.cwd));
}

function readLine(fd: number): string {
  const one = Buffer.alloc(1);
  let line = '';
  while (readSync(fd, one, 0, 1, null) > 0) {
    if (one[0] === 0x0a) break;
    line += String.fromCharCode(one[0]!);
  }
  return line;
}

/**
 * Typed confirmation on the controlling terminal. The Bash tool has none (ENXIO), so a model
 * cannot get past this. Success is the only way to obtain a `user` actor for gated ops;
 * --actor only supplies the display id.
 */
function confirmAsUser(env: Env, what: string): Env {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    throw new OpRefusedError('requires an interactive terminal; run this in your own terminal', true);
  }
  try {
    writeSync(fd, `\nDRIVER: ${what}\nType "yes" to confirm: `);
    if (readLine(fd).trim() !== 'yes') throw new OpRefusedError('not confirmed');
  } finally {
    closeSync(fd);
  }
  const given = env.flags.actor?.slice(env.flags.actor.indexOf(':') + 1);
  let id = given || undefined;
  if (!id) {
    try {
      id = execFileSync('git', ['config', 'user.name'], { cwd: env.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      // no git identity
    }
  }
  return { ...env, actor: { kind: 'user', id: id || process.env.USER || 'user' } };
}

interface Out {
  text: string;
  json?: unknown;
  exit?: number;
}

function write(env: Env, o: Out): void {
  const s = env.json ? JSON.stringify(o.json ?? { ok: true }) : o.text;
  if (s) process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
}

function commit(env: Env, driverDir: string, op: Op, opts: { doc?: boolean } = {}): Out {
  const r = mutate(driverDir, op, { actor: env.actor, now: env.now }, opts);
  return {
    text: r.created ?? `ok (revision ${r.plan.revision})`,
    json: { ok: true, revision: r.plan.revision, created: r.created, events: r.events.length },
  };
}

function issueLines(issues: Issue[]): string[] {
  return issues.map((i) => `${i.level} [${i.code}] ${i.path}: ${i.message}`);
}

function validateCmd(env: Env, dirArg: string | undefined): Out {
  const driverDir = locateDriverDir(env, dirArg);
  const file = path.join(driverDir, 'plan.json');
  if (!existsSync(file)) throw new NotInitializedError(driverDir);
  let issues: Issue[];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    issues = [{ level: 'error', code: 'parse', path: 'plan.json', message: (e as Error).message }];
    return validateResult(issues);
  }
  issues = validatePlan(raw, { fs: { exists: existsSync }, driverDir });
  if (env.flags.replay) {
    const parsed = PlanV1Schema.safeParse(raw);
    if (parsed.success) {
      try {
        issues.push(...replayIssues(parsed.data, readAllEvents(driverDir)));
      } catch (e) {
        issues.push({ level: 'error', code: 'replay.parse', path: 'events.jsonl', message: (e as Error).message });
      }
    }
  }
  return validateResult(issues);
}

function validateResult(issues: Issue[]): Out {
  const bad = hasErrors(issues);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  const summary = bad ? `invalid: ${errors} error(s), ${warnings} warning(s)` : `ok: ${warnings} warning(s)`;
  return {
    text: [...issueLines(issues), summary].join('\n'),
    json: { ok: !bad, issues },
    exit: bad ? 1 : 0,
  };
}

function statusCmd(env: Env, dirArg: string | undefined): Out {
  const plan = readPlan(locateDriverDir(env, dirArg));
  const active = Object.values(plan.blocks).filter((b) => !b.retired);
  const counts = Object.fromEntries(BLOCK_STATUSES.map((s) => [s, active.filter((b) => b.status === s).length]));
  const gate = (name: 'route' | 'release') => {
    const g = plan.gates[name];
    return g.approved ? `${name} approved (${g.approvedBy ?? '?'}, baseline ${g.atBaseline ?? '?'})` : `${name} not approved`;
  };
  const text = [
    `DRIVER ${plan.project.name}`,
    `phase: ${plan.currentPhase}   baseline: ${plan.baseline}   revision: ${plan.revision}`,
    `gates: ${gate('route')}; ${gate('release')}`,
    `blocks: ${active.length} active (${BLOCK_STATUSES.filter((s) => counts[s]).map((s) => `${s} ${counts[s]}`).join(', ') || 'none'})`,
  ].join('\n');
  return {
    text,
    json: {
      project: plan.project.name,
      phase: plan.currentPhase,
      baseline: plan.baseline,
      revision: plan.revision,
      gates: { route: plan.gates.route.approved, release: plan.gates.release.approved },
      blocks: counts,
    },
  };
}

function blockSet(env: Env, driverDir: string, id: string): Out {
  const f = env.flags;
  const patch: Extract<Op, { type: 'block.set' }>['patch'] = {};
  if (f.title !== undefined) patch.title = f.title;
  if (f.depends !== undefined) patch.dependsOn = list(f.depends)!;
  if (f.req !== undefined) patch.requirements = list(f.req)!;
  if (f.artifacts !== undefined) patch.artifacts = list(f.artifacts)!;
  if (f['add-artifact']) patch.addArtifacts = f['add-artifact'];
  if (f.test) patch.addTests = f.test.map(parseTest);
  if (f.risk !== undefined) patch.risk = oneOf(f.risk, ['low', 'medium', 'high'] as const, 'risk');
  if (f.provider !== undefined) patch.provider = parseProvider(f.provider, f.credentials);
  if (f.verified !== undefined)
    patch.verification = {
      passes: oneOf(f.verified, ['true', 'false'] as const, '--verified') === 'true',
      at: env.now,
      by: env.actor,
    };
  if (Object.keys(patch).length === 0) throw new UsageError('block set: nothing to change');
  return commit(env, driverDir, { type: 'block.set', id, patch });
}

function runCommand(env0: Env, pos: string[]): Out {
  let env = env0;
  const f = env.flags;
  const [cmd, sub, arg] = pos;
  const dir = () => locateDriverDir(env);

  switch (cmd) {
    case 'init': {
      const name = need(sub, 'name (init <name>)');
      const driverDir = dir();
      initDriverDir(driverDir, name, list(f.packs) ?? [], env.now);
      return { text: `initialized ${driverDir}`, json: { ok: true, driverDir } };
    }
    case 'validate':
      return validateCmd(env, sub);
    case 'status':
      return statusCmd(env, sub);
    case 'block': {
      switch (sub) {
        case 'add':
          return commit(env, dir(), {
            type: 'block.add',
            title: need(arg, 'title (block add <title>)'),
            phase: oneOf(need(f.phase, 'phase'), PHASES, 'phase'),
            dependsOn: list(f.depends),
            requirements: list(f.req),
            provider: parseProvider(f.provider, f.credentials),
            risk: f.risk ? oneOf(f.risk, ['low', 'medium', 'high'] as const, 'risk') : undefined,
          });
        case 'set':
          return blockSet(env, dir(), need(arg, 'block id'));
        case 'status': {
          if (f.owner !== undefined && pos[3] !== 'in_progress') throw new UsageError('--owner only applies to in_progress');
          if (f.force) env = confirmAsUser(env, `force block ${arg} -> ${pos[3]} (skips dependency checks) in ${env.cwd}`);
          return commit(env, dir(), {
            type: 'block.status',
            id: need(arg, 'block id'),
            to: oneOf(need(pos[3], 'target status'), BLOCK_STATUSES as readonly BlockStatus[], 'status'),
            reason: f.reason,
            force: f.force,
            owner: f.owner,
          });
        }
        case 'retire':
          return commit(env, dir(), {
            type: 'block.retire',
            id: need(arg, 'block id'),
            decision: need(f.decision, 'decision'),
            reason: need(f.reason, 'reason'),
          });
        case 'orphan':
          return commit(env, dir(), { type: 'block.orphan', owner: need(f.owner, 'owner') });
      }
      break;
    }
    case 'req': {
      if (sub === 'add')
        return commit(
          env,
          dir(),
          {
            type: 'req.add',
            title: need(arg, 'title (req add <title>)'),
            kind: oneOf(need(f.kind, 'kind'), ['functional', 'nonfunctional', 'constraint', 'non-goal'] as const, 'kind'),
            source: oneOf(need(f.source, 'source'), ['user', 'assumed'] as const, 'source'),
            ref: f.ref,
          },
          { doc: f.doc },
        );
      if (sub === 'retire')
        return commit(env, dir(), {
          type: 'req.retire',
          id: need(arg, 'requirement id'),
          decision: need(f.decision, 'decision'),
          reason: need(f.reason, 'reason'),
        });
      break;
    }
    case 'gate': {
      const gate = oneOf(need(arg, 'gate'), ['route', 'release'] as const, 'gate');
      if (sub === 'approve') {
        env = confirmAsUser(env, `approve gate ${gate} in ${env.cwd}`);
        return commit(env, dir(), { type: 'gate.approve', gate, decision: f.decision });
      }
      if (sub === 'revoke') return commit(env, dir(), { type: 'gate.revoke', gate, reason: need(f.reason, 'reason') });
      break;
    }
    case 'phase': {
      if (sub === 'advance') return commit(env, dir(), { type: 'phase.advance' });
      if (sub === 'back')
        return commit(env, dir(), {
          type: 'phase.back',
          to: oneOf(need(arg, 'phase'), PHASES, 'phase') as PhaseId,
          reason: need(f.reason, 'reason'),
        });
      break;
    }
    case 'decision': {
      if (sub !== 'add') break;
      return commit(env, dir(), { type: 'decision.add', title: f.title ?? need(arg, 'title'), reason: f.reason });
    }
    case 'rebaseline':
      env = confirmAsUser(env, `rebaseline (new baseline, resets changed blocks, revokes release gate) in ${env.cwd}`);
      return commit(env, dir(), { type: 'rebaseline', reason: need(f.reason, 'reason'), changed: list(f.changed), decision: f.decision });
    case 'release': {
      if (sub !== 'add') break;
      const driverDir = dir();
      const blocks =
        list(f.blocks) ??
        Object.entries(readPlan(driverDir).blocks)
          .filter(([, b]) => !b.retired && b.status === 'done')
          .map(([id]) => id)
          .sort();
      return commit(env, driverDir, {
        type: 'release.add',
        version: need(f.version, 'version'),
        commit: need(f.commit, 'commit'),
        blocks,
      });
    }
    case 'export': {
      if (sub !== 'mermaid') break;
      const driverDir = locateDriverDir(env, arg);
      const text = toMermaid(readPlan(driverDir));
      if (f.stdout) return { text, json: { ok: true, mermaid: text } };
      const out = f.out ? path.resolve(env.cwd, f.out) : path.join(driverDir, 'exports', 'plan.mmd');
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
      return { text: out, json: { ok: true, path: out } };
    }
    case 'renumber': {
      const driverDir = dir();
      const before = readPlan(driverDir).nextId;
      const r = mutate(driverDir, { type: 'renumber' }, { actor: env.actor, now: env.now });
      const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== r.plan.nextId[k]);
      return {
        text: changed.length ? changed.map((k) => `nextId.${k}: ${before[k]} -> ${r.plan.nextId[k]}`).join('\n') : 'nothing to renumber',
        json: { ok: true, changed: changed.map((k) => ({ counter: k, from: before[k], to: r.plan.nextId[k] })) },
      };
    }
  }
  throw new UsageError(`unknown command: ${pos.join(' ') || '(none)'}\n\n${HELP}`);
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function runHook(name: string | undefined): void {
  const input = parseHookInput(readStdin());
  try {
    if (name === 'gate-check' || name === 'protect-plan') {
      const reason = name === 'gate-check' ? gateCheck(input) : protectPlan(input);
      if (reason) process.stdout.write(`${denyOutput(reason)}\n`);
    } else if (name === 'subagent-stop') {
      const agent = input?.agent_id;
      if (!agent) return;
      const planFile = findPlanFile(path.resolve(input?.cwd ?? process.cwd()));
      if (!planFile) return;
      const driverDir = path.dirname(planFile);
      // Cheap unlocked pre-check: a stale read only costs a skipped or no-op orphan sweep.
      const owns = Object.values(readPlan(driverDir).blocks).some((b) => b.status === 'in_progress' && b.owner === agent);
      if (!owns) return;
      mutate(driverDir, { type: 'block.orphan', owner: agent }, { actor: { kind: 'hook', id: 'subagent-stop' }, now: new Date().toISOString() });
    }
  } catch (e) {
    // gate-check fails closed on its own; other hooks must never break the session
    if (name === 'gate-check') process.stdout.write(`${denyOutput(`DRIVER: gate check failed: ${(e as Error).message}`)}\n`);
  }
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    process.stderr.write(`driver: ${(e as Error).message}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals[0] === 'hook') {
    runHook(positionals[1]);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return values.help ? 0 : 2;
  }
  const json = values.json === true;
  try {
    const env: Env = {
      cwd: path.resolve(values.cwd ?? process.cwd()),
      actor: parseActor(values.actor ?? process.env.DRIVER_ACTOR ?? 'model:main'),
      now: values.now ?? new Date().toISOString(),
      json,
      flags: values,
    };
    const out = runCommand(env, positionals);
    write(env, out);
    return out.exit ?? 0;
  } catch (e) {
    const err = e as Error;
    const code =
      err instanceof UsageError || (err instanceof OpRefusedError && err.forbidden) ? 2 : 1;
    const known =
      code === 2 ||
      err instanceof OpRefusedError ||
      err instanceof PlanInvariantError ||
      err instanceof LockTimeoutError ||
      err instanceof RevisionConflictError ||
      err instanceof NotInitializedError;
    const message = known ? err.message : `unexpected: ${err.stack ?? err.message}`;
    process.stderr.write(json ? `${JSON.stringify({ ok: false, error: message })}\n` : `driver: ${message}\n`);
    return code;
  }
}

process.exitCode = main(process.argv.slice(2));
