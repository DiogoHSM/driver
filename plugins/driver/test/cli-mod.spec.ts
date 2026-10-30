import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLI, EXAMPLES, NOW, runCli, tmp } from './helpers.js';

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error('dist/cli.js missing: run `npm run build`');
});

function project() {
  const dir = tmp();
  const g = ['--cwd', dir, '--root', dir, '--now', NOW];
  const cli = (...a: string[]) => runCli([...g, ...a]);
  const input = (stdin: string, ...a: string[]) => runCli([...g, ...a], { input: stdin });
  expect(cli('init', 'demo').status).toBe(0);
  const dd = path.join(dir, '.claude', 'driver');
  const file = (f: string) => path.join(dd, f);
  const bytes = (f: string) => readFileSync(file(f));
  return {
    dir, dd, cli, input, file, bytes,
    plan: () => JSON.parse(readFileSync(file('plan.json'), 'utf8')),
    events: () => readFileSync(file('events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

describe('init', () => {
  it('creates .mod/ and gitignores it', () => {
    const p = project();
    expect(existsSync(p.file('.mod'))).toBe(true);
    expect(readFileSync(p.file('.gitignore'), 'utf8')).toContain('.mod/\n');
  });
});

describe('where', () => {
  it('reports root, driverDir and planExists', () => {
    const dir = tmp();
    const g = ['--cwd', dir, '--root', dir];
    const before = JSON.parse(runCli([...g, 'where', '--json']).stdout);
    expect(before).toEqual({ root: dir, driverDir: path.join(dir, '.claude', 'driver'), planExists: false });
    runCli([...g, 'init', 'x']);
    expect(JSON.parse(runCli([...g, 'where', '--json']).stdout).planExists).toBe(true);
    expect(runCli([...g, 'where']).stdout.trim()).toBe(dir);
  });

  it('honours DRIVER_ROOT', () => {
    const dir = tmp();
    const r = runCli(['--cwd', tmp(), 'where', '--json'], { env: { DRIVER_ROOT: dir } });
    expect(JSON.parse(r.stdout)).toMatchObject({ root: dir, planExists: false });
  });
});

describe('apply', () => {
  it('applies a batch under one revision, resolving $n references', () => {
    const p = project();
    const body = {
      ops: [
        { op: 'req.add', title: 'Users can sign up', kind: 'functional', source: 'user' },
        { op: 'decision.add', title: 'Use Postgres' },
        { op: 'block.add', title: 'Schema', phase: 'discover', requirements: ['$0'] },
        { op: 'block.add', title: 'API', phase: 'discover', dependsOn: ['$2'], requirements: ['$0'] },
        { op: 'block.set', id: '$3', patch: { addArtifacts: ['src/api.ts'], risk: 'high' } },
      ],
    };
    const r = p.input(JSON.stringify(body), 'apply', '--json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, revision: 1, created: ['R-001', 'D-001', 'B-001', 'B-002'] });
    const plan = p.plan();
    expect(plan.revision).toBe(1);
    expect(plan.blocks['B-002']).toMatchObject({ dependsOn: ['B-001'], requirements: ['R-001'], artifacts: ['src/api.ts'], risk: 'high' });
    const ev = p.events();
    expect(ev).toHaveLength(5);
    expect(new Set(ev.map((e) => e.revision))).toEqual(new Set([1]));
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(ev.map((e) => e.type)).toEqual(['req.add', 'decision.add', 'block.add', 'block.add', 'block.set']);
    expect(existsSync(p.file('blocks/B-001.md'))).toBe(true);
    expect(existsSync(p.file('decisions/D-001.md'))).toBe(true);
    expect(p.cli('validate', '--replay').status).toBe(0);
  });

  it('a failure mid-batch leaves plan.json, events and docs untouched', () => {
    const p = project();
    p.cli('block', 'add', 'Existing', '--phase', 'discover');
    const plan = p.bytes('plan.json');
    const events = p.bytes('events.jsonl');
    const body = { ops: [
      { op: 'block.add', title: 'Fine', phase: 'discover' },
      { op: 'block.add', title: 'Bad dep', phase: 'discover', dependsOn: ['B-404'] },
    ] };
    const r = p.input(JSON.stringify(body), 'apply', '--json');
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: false, failedOp: 1 });
    expect(out.error).toContain('B-404');
    expect(p.bytes('plan.json').equals(plan)).toBe(true);
    expect(p.bytes('events.jsonl').equals(events)).toBe(true);
    expect(existsSync(p.file('blocks/B-002.md'))).toBe(false);
    expect(existsSync(p.file('.lock'))).toBe(false);
  });

  it('an unresolved reference fails that op', () => {
    const p = project();
    const r = p.input(JSON.stringify({ ops: [{ op: 'block.add', title: 'x', phase: 'discover', dependsOn: ['$0'] }] }), 'apply', '--json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, failedOp: 0 });
  });

  it.each([
    [{ op: 'gate.approve', gate: 'route' }],
    [{ op: 'rebaseline', reason: 'x' }],
    [{ op: 'block.status', id: 'B-001', to: 'in_progress', force: true }],
    [{ op: 'release.add', version: '1', commit: 'x', blocks: [] }],
    [{ op: 'block.orphan', owner: 'x' }],
    [{ type: 'block.add', title: 'x', phase: 'discover' }],
  ])('never accepts %j', (op) => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    const plan = p.bytes('plan.json');
    const r = p.input(JSON.stringify({ ops: [{ op: 'phase.advance' }, op] }), 'apply', '--json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, failedOp: 1 });
    expect(p.bytes('plan.json').equals(plan)).toBe(true);
  });

  it('honours expectedRevision in the body', () => {
    const p = project();
    const r = p.input(JSON.stringify({ expectedRevision: 5, ops: [{ op: 'decision.add', title: 'x' }] }), 'apply', '--json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'revision conflict', current: 0 });
    const ok = p.input(JSON.stringify({ expectedRevision: 0, ops: [{ op: 'decision.add', title: 'x' }] }), 'apply', '--json');
    expect(ok.status).toBe(0);
  });

  it('rejects garbage on stdin with exit 2 and no write', () => {
    const p = project();
    const plan = p.bytes('plan.json');
    expect(p.input('not json', 'apply', '--json').status).toBe(2);
    expect(p.input('{}', 'apply', '--json').status).toBe(2);
    expect(p.input('{"ops":[]}', 'apply', '--json').status).toBe(2);
    expect(p.bytes('plan.json').equals(plan)).toBe(true);
  });

  it('applies phase and status ops in order (the model path)', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    const r = p.input(JSON.stringify({ ops: [{ op: 'block.status', id: 'B-001', to: 'in_progress', owner: 'agent-1' }] }), 'apply', '--json', '--actor', 'model:agent-1');
    expect(r.status).toBe(0);
    expect(p.plan().blocks['B-001']).toMatchObject({ status: 'in_progress', owner: 'agent-1' });
  });
});

describe('--expect-revision', () => {
  it('refuses on mismatch with a revision conflict and writes nothing', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover'); // revision 1
    const plan = p.bytes('plan.json');
    const r = p.cli('--expect-revision', '0', 'block', 'add', 'B', '--phase', 'discover', '--json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'revision conflict', current: 1 });
    expect(p.bytes('plan.json').equals(plan)).toBe(true);
    const ok = p.cli('--expect-revision', '1', 'block', 'add', 'B', '--phase', 'discover', '--json');
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).revision).toBe(2);
  });

  it('rejects a non-numeric value', () => {
    expect(project().cli('--expect-revision', 'x', 'decision', 'add', '--title', 't').status).toBe(2);
  });
});

describe('block owner (CAS)', () => {
  const setup = () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    p.cli('block', 'add', 'B', '--phase', 'discover');
    p.cli('--actor', 'model:orchestrator', 'block', 'status', 'B-001', 'in_progress', '--owner', 'main');
    return p;
  };

  it('transfers ownership when the current owner matches', () => {
    const p = setup();
    const r = p.cli('--actor', 'model:plat-9', 'block', 'owner', 'B-001', 'plat-9', '--from', 'main', '--json');
    expect(r.status).toBe(0);
    const b = p.plan().blocks['B-001'];
    expect(b).toMatchObject({ status: 'in_progress', owner: 'plat-9', statusBy: { kind: 'model', id: 'plat-9' } });
    expect(p.events().at(-1)).toMatchObject({ type: 'owner', block: 'B-001', from: 'main', to: 'plat-9', actor: { id: 'plat-9' } });
    expect(p.cli('validate', '--replay').status).toBe(0);
  });

  it('refuses when someone else owns it, when it is not in_progress, or without --from', () => {
    const p = setup();
    const plan = p.bytes('plan.json');
    const stale = p.cli('block', 'owner', 'B-001', 'plat-9', '--from', 'somebody-else');
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('owned by main');
    const idle = p.cli('block', 'owner', 'B-002', 'plat-9', '--from', 'main');
    expect(idle.status).toBe(1);
    expect(idle.stderr).toContain('not in_progress');
    expect(p.cli('block', 'owner', 'B-001', 'plat-9').status).toBe(2);
    expect(p.bytes('plan.json').equals(plan)).toBe(true);
  });
});

describe('gate approve --via-mod', () => {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const setup = () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover'); // revision 1
    const ticket = (over: Record<string, unknown> = {}, nonce = 'n0nce-123') =>
      writeFileSync(p.file('.mod/ticket.json'), JSON.stringify({ gate: 'route', revision: 1, sha256: sha(nonce), exp: Date.now() + 15000, iat: Date.now(), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, typeof v === 'function' ? (v as () => unknown)() : v])) }));
    const approve = (stdin: string, ...extra: string[]) => p.input(stdin, '--actor', 'user:diogo', 'gate', 'approve', 'route', '--via-mod', ...extra);
    return { ...p, ticket, approve };
  };

  it('approves with a valid ticket and the nonce on stdin, as the user, and consumes the ticket', () => {
    const p = setup();
    p.ticket();
    const r = p.approve('n0nce-123\n', '--json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, revision: 2 });
    expect(p.plan().gates.route).toMatchObject({ approved: true, approvedBy: 'diogo', atBaseline: 1 });
    expect(existsSync(p.file('.mod/ticket.json'))).toBe(false);
    expect(p.events().at(-1)).toMatchObject({ type: 'gate.approve', actor: { kind: 'user', id: 'diogo' }, data: { via: 'mod', ticket: sha('n0nce-123') } });
    expect(p.plan().gates.route).toMatchObject({ approvedVia: 'mod', approvedTicket: sha('n0nce-123') });
    expect(p.cli('validate', '--replay').status).toBe(0);
  });

  it('falls back to git user.name / $USER when --actor is not given', () => {
    const p = setup();
    p.ticket();
    const r = p.input('n0nce-123', 'gate', 'approve', 'route', '--via-mod');
    expect(r.status).toBe(0);
    expect(p.plan().gates.route.approvedBy).toBeTruthy();
    expect(p.plan().gates.route.approvedBy).not.toBe('main');
  });

  it('refuses without a ticket (exit 2)', () => {
    const p = setup();
    const r = p.approve('n0nce-123');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no approval ticket');
    expect(p.plan().gates.route.approved).toBe(false);
  });

  it.each([
    ['expired', { exp: Date.now() - 1 }, 'n0nce-123', /expired/],
    ['wrong gate', { gate: 'release' }, 'n0nce-123', /for gate release, not route/],
    ['wrong revision', { revision: 0 }, 'n0nce-123', /plan changed since the ticket was issued \(ticket revision 0, plan revision 1\)/],
    ['wrong hash', {}, 'another-nonce', /does not match/],
    ['empty stdin', {}, '', /does not match/],
    ['malformed hash', { sha256: 'zz' }, 'n0nce-123', /does not match/],
    ['missing exp', { exp: undefined }, 'n0nce-123', /expired/],
    ['exp far in the future', { exp: Date.now() + 3_600_000 }, 'n0nce-123', /too far ahead/],
    ['exp at the end of time', { exp: 9999999999999 }, 'n0nce-123', /too far ahead/],
    ['stale iat', { iat: () => Date.now() - 60_000, exp: () => Date.now() + 5000 }, 'n0nce-123', /not fresh/],
    ['missing iat', { iat: undefined }, 'n0nce-123', /not fresh/],
  ])('refuses %s with exit 2, burns the ticket and changes nothing', (_name, over, nonce, re) => {
    const p = setup();
    p.ticket(over as Record<string, unknown>);
    const before = p.bytes('plan.json');
    const r = p.approve(nonce);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(re);
    expect(existsSync(p.file('.mod/ticket.json'))).toBe(false);
    expect(p.bytes('plan.json').equals(before)).toBe(true);
    // even the right nonce no longer works: the ticket is gone
    expect(p.approve('n0nce-123').status).toBe(2);
  });

  it('cannot be replayed: the second use of the same ticket fails', () => {
    const p = setup();
    p.ticket();
    expect(p.approve('n0nce-123').status).toBe(0);
    const again = p.approve('n0nce-123');
    expect(again.status).toBe(2);
    expect(again.stderr).toContain('no approval ticket');
  });

  it('takes the nonce only from stdin, never from argv', () => {
    const p = setup();
    p.ticket();
    const withArg = p.input('', '--actor', 'user:diogo', 'gate', 'approve', 'route', '--via-mod', '--nonce', 'n0nce-123');
    expect(withArg.status).toBe(2);
    expect(p.plan().gates.route.approved).toBe(false);
    p.ticket();
    const positional = p.input('', '--actor', 'user:diogo', 'gate', 'approve', 'route', 'n0nce-123', '--via-mod');
    expect(positional.status).toBe(2);
    expect(p.plan().gates.route.approved).toBe(false);
  });

  it('a model-kind Bash invocation is still denied by the hook, and the TTY path still refuses without a terminal', () => {
    const p = setup();
    const r = runCli(['hook', 'protect-plan'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'driver gate approve route --via-mod < nonce.txt' }, cwd: p.dir }),
    });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(p.cli('gate', 'approve', 'route').status).toBe(2);
  });
});

describe('status --json', () => {
  it('has the shape the mod reads', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    p.cli('block', 'add', 'B', '--phase', 'discover', '--depends', 'B-001');
    p.cli('--actor', 'model:a1', 'block', 'status', 'B-001', 'in_progress', '--owner', 'a1');
    const j = JSON.parse(p.cli('status', '--json').stdout);
    expect(Object.keys(j).sort()).toEqual(['baseline', 'blocked', 'counts', 'currentPhase', 'gates', 'inProgress', 'project', 'ready', 'revision']);
    expect(j).toMatchObject({
      project: 'demo', currentPhase: 'discover', baseline: 0, revision: 3,
      gates: { route: { approved: false }, release: { approved: false } },
      counts: { not_started: 1, in_progress: 1, blocked: 0, in_review: 0, done: 0, needs_rework: 0 },
      ready: [],
      inProgress: [{ id: 'B-001', owner: 'a1' }],
      blocked: [],
    });
  });

  it('lists ready blocks on the example', () => {
    const j = JSON.parse(runCli(['status', path.join(EXAMPLES, 'web-waitlist'), '--json']).stdout);
    expect(j.currentPhase).toBe('implement');
    expect(j.counts.done).toBe(3);
    expect(j.blocked).toEqual([{ id: 'B-005', reason: expect.any(String) }]);
    expect(j.inProgress).toEqual([]);
    expect(Array.isArray(j.ready)).toBe(true);
  });
});

describe('subcommand words come first for the user-only commands', () => {
  it.each([
    [['gate', '--via-mod', 'approve', 'route']],
    [['--via-mod', 'gate', 'approve', 'route']],
    [['gate', '--decision', 'D-1', 'approve', 'route']],
    [['--reason', 'x', 'rebaseline']],
    [['block', '--force', 'status', 'B-001', 'done']],
    [['--force', 'block', 'status', 'B-001', 'done']],
    [['--phase', 'x', 'apply']],
  ])('%j is refused with exit 2', (args) => {
    const p = project();
    const r = p.input('', ...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/must come|subcommand words/);
  });

  it('global options may still lead, and values may start with a dash through =', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    const r = p.input('', '--json', '--actor', 'model:main', 'block', 'status', 'B-001', 'blocked', '--reason=--force');
    expect(r.stderr + r.stdout).not.toMatch(/ambiguous|must come/);
  });
});

describe('apply attributes a verification to the caller', () => {
  it('overwrites a user-supplied by/at', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    const body = JSON.stringify({ ops: [{ op: 'block.set', id: 'B-001', patch: { verification: { passes: true, at: '2001-01-01T00:00:00Z', by: { kind: 'user', id: 'diogo' } } } }] });
    const r = p.input(body, '--actor', 'model:main', 'apply');
    expect(r.status).toBe(0);
    expect(p.plan().blocks['B-001']?.verification?.by).toMatchObject({ kind: 'model', id: 'main' });
  });
});

describe('what the CLI cannot prevent, it records', () => {
  it('a ticket forged with node -e is accepted, and the approval says via: mod with the forged hash', () => {
    const p = project();
    p.cli('block', 'add', 'A', '--phase', 'discover');
    const target = path.join(p.dd, '.mod', 'ticket.json');
    const script = `const fs=require('fs'),c=require('crypto');fs.writeFileSync(${JSON.stringify(target)},JSON.stringify({gate:'route',revision:1,sha256:c.createHash('sha256').update('x').digest('hex'),iat:Date.now(),exp:Date.now()+10000}))`;
    mkdirSync(path.dirname(target), { recursive: true });
    expect(spawnSync(process.execPath, ['-e', script]).status).toBe(0);
    const r = p.input('x', '--actor', 'user:diogo', 'gate', 'approve', 'route', '--via-mod');
    expect(r.status).toBe(0);
    expect(p.plan().gates.route).toMatchObject({ approved: true, approvedVia: 'mod', approvedTicket: createHash('sha256').update('x').digest('hex') });
  });
});
