import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ApplyInputError, parseApplyBody } from './apply.js';
import { BlockDocRefusedError, writeBlockDocs } from './block-doc.js';
import { ReqDocRefusedError, writeReqDocs } from './req-doc.js';
import { DiscoverRefusedError, countsByStatus, frontier, line1, logDiscover, readState, summaryText, type DiscoverState } from './discover-log.js';
import { denyOutput,findPlanFile, gateCheck, parseHookInput, protectPlan } from './hooks.js';
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
  BatchError,
  LockTimeoutError,
  NotInitializedError,
  RevisionConflictError,
  driverDirOf,
  initDriverDir,
  mutate,
  mutateMany,
  readAllEvents,
  readPlan,
  resolveProjectRoot,
} from './store.js';
import { project, summarize } from './shared/view.js';
import { hasErrors, validatePlan, type Issue } from './validate.js';

class UsageError extends Error {}

const HELP = `driver <command> [options]

  init <name> [--packs a,b]
  validate [dir] [--replay]
  status [dir]
  where
  apply                                      (ops JSON on stdin: {"ops":[{"op":"block.add",...}],"expectedRevision":N}; "$0" refers to the first created id)
  discover log                               (JSON on stdin: {"meta":{..},"nodes":[..],"nonGoals":[..]}; appends to discover/interview.jsonl, regenerates the three discover/*.md)
  discover show                              (interview state and frontier, no write)
  block add <title> --phase <p> [--depends B-001,..] [--req R-001,..] [--provider cap:provider:access] [--credentials A,B] [--risk low|medium|high]
  block set <id> [--title] [--depends] [--req] [--artifacts a,b] [--add-artifact p] [--test ref:layer:result] [--verified true|false] [--provider] [--credentials] [--risk]
  block doc                                  (JSON on stdin: {"blocks":[{"id":"B-004","spec"?,"acceptance"?:[..],"notes"?,"handoff"?}]}, 1..30; rewrites only the named sections of blocks/<id>.md; no plan change)
  block status <id> <to> [--reason ..] [--owner <platform agent id>] [--force]
  block retire <id> --decision D-001 --reason ..
  block orphan --owner <agentId>
  block owner <id> <agentId> --from <prev>
  decision add --title .. [--reason ..]
  req doc                                    (JSON on stdin: {"requirements":[{"id":"R-003","statement"?,"acceptance"?,"origin"?,"notes"?}]}, 1..30; rewrites only the named sections of requirements/<id>.md; no plan change)
  req add <title> --kind functional|nonfunctional|constraint|non-goal --source user|assumed [--ref ..] [--doc]
  req retire <id> --decision D-001 --reason ..
  gate approve <route|release> [--via-mod] | gate revoke <route|release> --reason ..
  phase advance | phase back <phase> --reason ..
  rebaseline --reason .. [--changed B-001,..] [--decision D-001]
  release add --version V --commit SHA [--blocks B-001,..]
  export mermaid [dir] [--out path] [--stdout]
  renumber
  hook gate-check | protect-plan | subagent-stop     (reads hook JSON on stdin)

gate approve, rebaseline and --force ask for a typed "yes" on /dev/tty (user terminal only).
gate approve --via-mod reads a one-shot nonce on stdin and checks .claude/driver/.mod/ticket.json (written by the mod).
values that start with "-" go as --reason=<v> / --owner=<v>.
global: --cwd <dir>  --root <dir>  --actor <kind:id>  --json  --now <iso>  --expect-revision <n>
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
  from: { type: 'string' },
  'via-mod': { type: 'boolean' },
  'expect-revision': { type: 'string' },
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
  return asUser(env);
}

/** The user actor for a confirmed action: --actor's id, else git user.name, else $USER. */
function asUser(env: Env): Env {
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

interface Ticket {
  gate?: unknown;
  revision?: unknown;
  sha256?: unknown;
  exp?: unknown;
  iat?: unknown;
}

/**
 * Approval through the mod: a ticket written by the mod on the user's own Enter plus the
 * one-shot nonce on stdin. The ticket is consumed (unlinked) before anything is checked.
 */
const TICKET_MAX_AGE_MS = 20000;

function consumeTicket(driverDir: string, gate: string, nonce: string): { revision: number; sha256: string } {
  const file = path.join(driverDir, '.mod', 'ticket.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new OpRefusedError('no approval ticket (approve through the mod, or run "driver gate approve" in your terminal)', true);
  }
  rmSync(file, { force: true });
  let t: Ticket;
  try {
    t = JSON.parse(raw) as Ticket;
  } catch {
    throw new OpRefusedError('approval ticket is malformed', true);
  }
  const now = Date.now();
  if (typeof t.exp !== 'number' || t.exp < now) throw new OpRefusedError('approval ticket expired', true);
  if (t.exp - now > TICKET_MAX_AGE_MS) throw new OpRefusedError('approval ticket expires too far ahead', true);
  if (typeof t.iat !== 'number' || t.iat > now + 2000 || now - t.iat > TICKET_MAX_AGE_MS)
    throw new OpRefusedError('approval ticket is not fresh', true);
  if (t.gate !== gate) throw new OpRefusedError(`approval ticket is for gate ${String(t.gate)}, not ${gate}`, true);
  const plan = readPlan(driverDir);
  if (typeof t.revision !== 'number' || plan.revision !== t.revision)
    throw new OpRefusedError(`plan changed since the ticket was issued (ticket revision ${String(t.revision)}, plan revision ${plan.revision})`, true);
  const want = typeof t.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(t.sha256) ? Buffer.from(t.sha256, 'hex') : undefined;
  const got = createHash('sha256').update(nonce, 'utf8').digest();
  if (!want || !timingSafeEqual(want, got)) throw new OpRefusedError('approval code does not match the ticket', true);
  return { revision: t.revision, sha256: String(t.sha256).toLowerCase() };
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

function expectedRevision(env: Env): number | undefined {
  const v = env.flags['expect-revision'];
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError('--expect-revision must be a non-negative integer');
  return Number(v);
}

function commit(env: Env, driverDir: string, op: Op, opts: { doc?: boolean; expectedRevision?: number } = {}): Out {
  const r = mutate(driverDir, op, { actor: env.actor, now: env.now }, { expectedRevision: expectedRevision(env), ...opts });
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
  const view = project(plan);
  const sum = summarize(view);
  const active = view.blocks.filter((b) => !b.retired);
  const counts = sum.counts;
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
      project: view.project,
      currentPhase: view.currentPhase,
      baseline: view.baseline,
      revision: view.revision,
      gates: view.gates,
      counts,
      ready: sum.ready,
      inProgress: sum.inProgress,
      blocked: sum.blocked,
    },
  };
}

function whereCmd(env: Env): Out {
  const driverDir = locateDriverDir(env);
  const root = path.dirname(path.dirname(driverDir));
  const planExists = existsSync(path.join(driverDir, 'plan.json'));
  return { text: root, json: { root, driverDir, planExists } };
}

function applyCmd(env: Env, driverDir: string): Out {
  let body;
  try {
    body = parseApplyBody(readStdin());
  } catch (e) {
    if (e instanceof ApplyInputError && e.failedOp === undefined) throw new UsageError(e.message);
    throw e;
  }
  // a verification is always attributed to whoever applies it, never to a name the caller supplied
  const ops = body.ops.map((o) =>
    o.type === 'block.set' && o.patch.verification ? { ...o, patch: { ...o.patch, verification: { ...o.patch.verification, at: env.now, by: env.actor } } } : o,
  );
  const r = mutateMany(driverDir, ops, { actor: env.actor, now: env.now }, { expectedRevision: body.expectedRevision ?? expectedRevision(env) });
  return {
    text: `ok (revision ${r.plan.revision})${r.created.length ? `; created ${r.created.join(', ')}` : ''}`,
    json: { ok: true, revision: r.plan.revision, created: r.created },
  };
}

function discoverCmd(env: Env, driverDir: string, sub: string | undefined): Out {
  if (sub !== 'log' && sub !== 'show') throw new UsageError('discover: expected "log" or "show"');
  if (!existsSync(path.join(driverDir, 'plan.json'))) throw new NotInitializedError(driverDir);
  if (sub === 'log') {
    let raw: unknown;
    try {
      raw = JSON.parse(readStdin());
    } catch {
      throw new UsageError('discover log: stdin must hold one JSON object {meta?, nodes?, nonGoals?}');
    }
    const r = logDiscover(driverDir, raw, env.now);
    return { text: r.text, json: { ok: true, text: r.text, created: r.created, counts: countsByStatus(r.state), state: r.state, frontier: r.frontier, warnings: r.warnings } };
  }
  const { state, exists } = readState(driverDir);
  const f = frontier(state);
  const text = exists ? `${summaryText(state)}\n${showNodes(state)}` : 'no discovery interview yet';
  return { text, json: { ok: true, exists, state, frontier: f } };
}

function showNodes(state: DiscoverState): string {
  const m = state.meta;
  const lines = [`goal: ${line1(m.goal) || '-'}`, `class: ${m.class ?? '-'}; domain: ${line1(m.domain) || '-'}; language: ${line1(m.language) || '-'}; checkpoint: ${m.checkpoint}; accepted: ${m.accepted ? 'yes' : 'no'}`];
  for (const n of state.nodes)
    lines.push(`${n.id} [${n.status}${n.assumption ? ` ${n.assumption}` : ''}] ${line1(n.question)}${n.answer ? ` => ${line1(n.answer)}` : ''}`);
  for (const g of state.nonGoals) lines.push(`${g.id} ${line1(g.statement)}${g.reason ? ` (${line1(g.reason)})` : ''}`);
  return lines.join('\n');
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
    case 'where':
      return whereCmd(env);
    case 'apply':
      return applyCmd(env, dir());
    case 'discover':
      return discoverCmd(env, dir(), sub);
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
        case 'doc': {
          let raw: unknown;
          try {
            raw = JSON.parse(readStdin());
          } catch {
            throw new UsageError('block doc: stdin must hold one JSON object {"blocks":[{"id":"B-004","spec"?,"acceptance"?,"notes"?,"handoff"?}]}');
          }
          const r = writeBlockDocs(dir(), raw);
          return { text: r.text, json: { ok: true, text: r.text, blocks: r.blocks } };
        }
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
        case 'owner':
          return commit(env, dir(), {
            type: 'block.owner',
            id: need(arg, 'block id'),
            owner: need(pos[3], 'agent id (block owner <id> <agentId> --from <prev>)'),
            from: need(f.from, 'from'),
          });
      }
      break;
    }
    case 'req': {
      if (sub === 'doc') {
        let raw: unknown;
        try {
          raw = JSON.parse(readStdin());
        } catch {
          throw new UsageError('req doc: stdin must hold one JSON object {"requirements":[{"id":"R-003","statement"?,"acceptance"?,"origin"?,"notes"?}]}');
        }
        const r = writeReqDocs(dir(), raw);
        return { text: r.text, json: { ok: true, text: r.text, requirements: r.requirements } };
      }
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
      if (sub === 'approve' && f['via-mod']) {
        const driverDir = dir();
        const ticket = consumeTicket(driverDir, gate, readStdin().trim());
        env = asUser(env);
        return commit(env, driverDir, { type: 'gate.approve', gate, decision: f.decision, via: 'mod', ticket: ticket.sha256 }, { expectedRevision: ticket.revision });
      }
      if (sub === 'approve') {
        env = confirmAsUser(env, `approve gate ${gate} in ${env.cwd}`);
        return commit(env, dir(), { type: 'gate.approve', gate, decision: f.decision, via: 'tty' });
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
      const r = mutate(driverDir, { type: 'renumber' }, { actor: env.actor, now: env.now }, { expectedRevision: expectedRevision(env) });
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

const GLOBAL_OPTIONS = new Set(['cwd', 'root', 'actor', 'json', 'now', 'expect-revision']);

type Token = { kind: string; name?: string };

/**
 * parseArgs lets options sit between positionals, so `gate --via-mod approve` would parse like
 * `gate approve --via-mod` while slipping past text filters. For the user-only commands the
 * subcommand words must come first; only the global options may precede them.
 */
function checkWordOrder(tokens: readonly Token[]): void {
  const at = tokens.findIndex((t) => t.kind === 'positional');
  if (at < 0) return;
  const cmd = (tokens[at] as { value?: string }).value;
  if (!['gate', 'rebaseline', 'block', 'apply'].includes(cmd ?? '')) return;
  for (const t of tokens.slice(0, at))
    if (t.kind === 'option' && !GLOBAL_OPTIONS.has(t.name ?? '')) throw new UsageError(`${cmd}: option --${t.name} must come after the subcommand words`);
  const next = tokens[at + 1];
  if ((cmd === 'gate' || cmd === 'block') && next && next.kind !== 'positional')
    throw new UsageError(`${cmd}: the subcommand words must come right after "${cmd}", options after them`);
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, tokens: true });
  } catch (e) {
    process.stderr.write(`driver: ${(e as Error).message}\n`);
    return 2;
  }
  const { values, positionals, tokens } = parsed;
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
    checkWordOrder(tokens ?? []);
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
    // machine-readable failures go to stdout (like results); the human line stays on stderr
    const fail = (message: string, extra: Record<string, unknown>): number => {
      if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra })}\n`);
      process.stderr.write(`driver: ${message}\n`);
      return 1;
    };
    if (err instanceof BatchError) return fail(err.cause.message, { failedOp: err.index });
    if (err instanceof ApplyInputError) return fail(err.message, err.failedOp === undefined ? {} : { failedOp: err.failedOp });
    if (err instanceof RevisionConflictError) return fail('revision conflict', { current: err.actual, expected: err.expected });
    const code =
      err instanceof UsageError || (err instanceof OpRefusedError && err.forbidden) ? 2 : 1;
    const known =
      code === 2 ||
      err instanceof OpRefusedError ||
      err instanceof DiscoverRefusedError ||
      err instanceof BlockDocRefusedError ||
      err instanceof ReqDocRefusedError ||
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
