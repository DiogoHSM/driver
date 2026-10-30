import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpRefusedError, PlanInvariantError } from '../src/reducer.js';
import {
  LockTimeoutError,
  RevisionConflictError,
  appendEvents,
  initDriverDir,
  mutate,
  readAllEvents,
  readEvents,
  parseMainWorktree,
  recoverStaleLock,
  checkHandoff,
  readPlan,
  resolveProjectRoot,
  serializePlan,
  withLock,
} from '../src/store.js';
import { emptyPlan, type Actor } from '../src/schema.js';
import { OpRefusedError as Refused } from '../src/reducer.js';
import { CLI, MODEL, NOW, USER, tmp } from './helpers.js';

function setup(): string {
  const dir = path.join(tmp(), '.claude', 'driver');
  initDriverDir(dir, 'demo', ['p'], NOW);
  return dir;
}
const ctx = { actor: MODEL, now: NOW };
const add = (dir: string, title = 'A') =>
  mutate(dir, { type: 'block.add', title, phase: 'discover' }, ctx);

describe('initDriverDir', () => {
  it('creates the layout', () => {
    const dir = setup();
    for (const d of ['blocks', 'requirements', 'decisions', 'discover', 'exports', 'log', '.mod'])
      expect(existsSync(path.join(dir, d))).toBe(true);
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('exports/\n.lock/\n.tmp/\n.mod/\n');
    expect(readFileSync(path.join(dir, '.gitattributes'), 'utf8')).toBe('events.jsonl merge=union\n');
    expect(readFileSync(path.join(dir, 'events.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(path.join(dir, 'plan.json'), 'utf8')).toBe(serializePlan(emptyPlan('demo', ['p'], NOW)));
  });

  it('refuses to overwrite an existing plan', () => {
    const dir = setup();
    expect(() => initDriverDir(dir, 'again', [], NOW)).toThrow(/already exists/);
  });
});

describe('mutate', () => {
  it('increments revision per write and writes block docs', () => {
    const dir = setup();
    expect(add(dir).plan.revision).toBe(1);
    const r = add(dir, 'B "quoted"');
    expect(r.plan.revision).toBe(2);
    expect(r.created).toBe('B-002');
    expect(readPlan(dir).revision).toBe(2);
    const md = readFileSync(path.join(dir, 'blocks', 'B-002.md'), 'utf8');
    expect(md).toContain('id: B-002');
    expect(md).toContain('title: "B \\"quoted\\""');
    for (const h of ['## Spec', '## Acceptance criteria', '## Notes', '## Handoff']) expect(md).toContain(h);
  });

  it('serializes deterministically: sorted keys, 2 spaces, trailing newline', () => {
    const dir = setup();
    add(dir);
    const text = readFileSync(path.join(dir, 'plan.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "baseline": 0,')).toBe(true);
    expect(text).toBe(serializePlan(readPlan(dir)));
  });

  it('events: seq is monotonic and carries the revision', () => {
    const dir = setup();
    add(dir);
    add(dir);
    mutate(dir, { type: 'block.status', id: 'B-001', to: 'in_progress' }, ctx);
    const ev = readEvents(dir);
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(ev.map((e) => e.revision)).toEqual([1, 2, 3]);
    expect(ev[2]).toMatchObject({ type: 'block.status', block: 'B-001', from: 'not_started', to: 'in_progress' });
  });

  it('refused or invalid ops leave plan.json, events and docs byte-identical', () => {
    const dir = setup();
    add(dir);
    const before = readFileSync(path.join(dir, 'plan.json'));
    const eventsBefore = readFileSync(path.join(dir, 'events.jsonl'));
    expect(() => mutate(dir, { type: 'block.status', id: 'B-001', to: 'done' }, ctx)).toThrow(OpRefusedError);
    expect(() =>
      mutate(dir, { type: 'block.add', title: 'bad', phase: 'discover', dependsOn: ['B-404'] }, ctx),
    ).toThrow(PlanInvariantError);
    expect(readFileSync(path.join(dir, 'plan.json')).equals(before)).toBe(true);
    expect(readFileSync(path.join(dir, 'events.jsonl')).equals(eventsBefore)).toBe(true);
    expect(existsSync(path.join(dir, 'blocks', 'B-002.md'))).toBe(false);
  });

  it('expectedRevision mismatch throws', () => {
    const dir = setup();
    add(dir);
    expect(() =>
      mutate(dir, { type: 'block.add', title: 'x', phase: 'discover' }, ctx, { expectedRevision: 0 }),
    ).toThrow(RevisionConflictError);
    expect(mutate(dir, { type: 'block.add', title: 'x', phase: 'discover' }, ctx, { expectedRevision: 1 }).plan.revision).toBe(2);
  });

  it('writes a decision doc on gate approval and rebaseline, and a req doc only with doc', () => {
    const dir = setup();
    mutate(dir, { type: 'req.add', title: 'R', kind: 'functional', source: 'user' }, ctx);
    expect(existsSync(path.join(dir, 'requirements', 'R-001.md'))).toBe(false);
    mutate(dir, { type: 'req.add', title: 'R2', kind: 'functional', source: 'user' }, ctx, { doc: true });
    expect(existsSync(path.join(dir, 'requirements', 'R-002.md'))).toBe(true);
    mutate(dir, { type: 'block.add', title: 'A', phase: 'discover', requirements: ['R-001', 'R-002'] }, ctx);
    mutate(dir, { type: 'gate.approve', gate: 'route' }, { actor: USER, now: NOW });
    expect(readFileSync(path.join(dir, 'decisions', 'D-001.md'), 'utf8')).toContain('Gate 1: route approved');
    mutate(dir, { type: 'rebaseline', reason: 'scope change' }, { actor: USER, now: NOW });
    expect(readFileSync(path.join(dir, 'decisions', 'D-002.md'), 'utf8')).toContain('scope change');
  });

  it('appendEvents reads the last seq cheaply from a long file', () => {
    const dir = setup();
    const e = { ts: NOW, actor: MODEL, type: 'orphan' as const };
    appendEvents(dir, Array.from({ length: 300 }, () => ({ ...e, data: { pad: 'x'.repeat(100) } })));
    expect(appendEvents(dir, [e])[0]!.seq).toBe(301);
  });
});

describe('lock', () => {
  const dead = (): number => {
    const r = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    return Number(r.stdout);
  };

  it('recovers a stale lock held by a dead pid', () => {
    const dir = setup();
    mkdirSync(path.join(dir, '.lock'));
    writeFileSync(path.join(dir, '.lock', 'owner.json'), JSON.stringify({ pid: dead(), ts: Date.now() - 60_000 }));
    expect(add(dir).plan.revision).toBe(1);
    expect(existsSync(path.join(dir, '.lock'))).toBe(false);
  });

  it('recovers a stale lock without owner.json using the directory age', () => {
    const dir = setup();
    mkdirSync(path.join(dir, '.lock'));
    const old = new Date(Date.now() - 60_000);
    utimesSync(path.join(dir, '.lock'), old, old);
    expect(add(dir).plan.revision).toBe(1);
  });

  it('does not steal a fresh lock; times out', () => {
    const dir = setup();
    mkdirSync(path.join(dir, '.lock'));
    writeFileSync(path.join(dir, '.lock', 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }));
    expect(() => withLock(dir, () => 1, 150)).toThrow(LockTimeoutError);
    expect(existsSync(path.join(dir, '.lock'))).toBe(true);
  });

  it('does not steal an old lock whose pid is alive', () => {
    const dir = setup();
    mkdirSync(path.join(dir, '.lock'));
    writeFileSync(path.join(dir, '.lock', 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() - 60_000 }));
    expect(() => withLock(dir, () => 1, 150)).toThrow(LockTimeoutError);
  });

  it('releases the lock when fn throws', () => {
    const dir = setup();
    expect(() => withLock(dir, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(path.join(dir, '.lock'))).toBe(false);
  });
});

describe('resolveProjectRoot', () => {
  it('falls back to cwd outside git', () => {
    const d = tmp();
    expect(resolveProjectRoot(d)).toBe(path.resolve(d));
  });

  it('returns the main worktree from a linked worktree', () => {
    const d = tmp();
    const main = path.join(d, 'main');
    const wt = path.join(d, 'wt');
    const sh = (args: string[], cwd: string) => spawnSync('git', args, { cwd, encoding: 'utf8' });
    mkdirSync(main);
    sh(['init', '-q', '-b', 'main'], main);
    sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], main);
    sh(['worktree', 'add', '-q', wt], main);
    const real = (p: string) => spawnSync('realpath', [p], { encoding: 'utf8' }).stdout.trim();
    expect(real(resolveProjectRoot(wt))).toBe(real(main));
    expect(real(resolveProjectRoot(path.join(main)))).toBe(real(main));
  });
});

describe('concurrency', () => {
  it('two processes adding 10 blocks each never corrupt the plan or duplicate ids', async () => {
    const dir = setup();
    const root = path.resolve(dir, '..', '..');
    const script = (tag: string) =>
      `for i in 1 2 3 4 5 6 7 8 9 10; do node "${CLI}" --cwd "${root}" --root "${root}" block add "${tag}$i" --phase discover >/dev/null || exit 1; done`;
    const run = (tag: string) =>
      new Promise<number | null>((resolve) => {
        const c = spawn('bash', ['-c', script(tag)], { stdio: 'inherit' });
        c.on('close', resolve);
      });
    const codes = await Promise.all([run('a'), run('b')]);
    expect(codes).toEqual([0, 0]);

    const plan = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    const ids = Object.keys(plan.blocks).sort();
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `B-${String(i + 1).padStart(3, '0')}`));
    expect(new Set(ids).size).toBe(20);
    expect(plan.revision).toBe(20);
    expect(plan.nextId.B).toBe(21);

    const events = readEvents(dir);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: events.length }, (_, i) => i + 1));
    expect(events).toHaveLength(20);
    expect(events.map((e) => e.revision)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(existsSync(path.join(dir, '.lock'))).toBe(false);
  }, 90_000);
});

describe('stale lock race', () => {
  const dead = (): number =>
    Number(spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
  const staleLock = (dir: string) => {
    mkdirSync(path.join(dir, '.lock'));
    writeFileSync(path.join(dir, '.lock', 'owner.json'), JSON.stringify({ pid: dead(), ts: Date.now() - 60_000 }));
  };

  it('recoverStaleLock lets exactly one recovery win and leaves no debris', () => {
    const dir = setup();
    staleLock(dir);
    const lock = path.join(dir, '.lock');
    expect(recoverStaleLock(lock)).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(recoverStaleLock(lock)).toBe(true); // nothing left: caller may just retry mkdir
    expect(readdirSync(dir).filter((f) => f.startsWith('.lock'))).toEqual([]);
  });

  it('does not touch a fresh lock', () => {
    const dir = setup();
    mkdirSync(path.join(dir, '.lock'));
    writeFileSync(path.join(dir, '.lock', 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }));
    expect(recoverStaleLock(path.join(dir, '.lock'))).toBe(false);
    expect(existsSync(path.join(dir, '.lock'))).toBe(true);
  });

  it('two processes recovering the same stale lock both succeed without duplicate ids', async () => {
    const dir = setup();
    staleLock(dir);
    const root = path.resolve(dir, '..', '..');
    const one = (tag: string) =>
      new Promise<number | null>((resolve) => {
        const c = spawn('node', [CLI, '--cwd', root, '--root', root, 'block', 'add', tag, '--phase', 'discover'], { stdio: 'ignore' });
        c.on('close', resolve);
      });
    expect(await Promise.all([one('a'), one('b')])).toEqual([0, 0]);
    const plan = readPlan(dir);
    expect(Object.keys(plan.blocks).sort()).toEqual(['B-001', 'B-002']);
    expect(plan.revision).toBe(2);
  }, 30_000);
});

describe('handoff pre-check', () => {
  const started = () => {
    const dir = setup();
    add(dir);
    mutate(dir, { type: 'block.set', id: 'B-001', patch: { addArtifacts: ['a.md'] } }, ctx);
    mutate(dir, { type: 'block.status', id: 'B-001', to: 'in_progress' }, ctx);
    return dir;
  };
  const review = (dir: string, actor: Actor = MODEL, force?: boolean) =>
    mutate(dir, { type: 'block.status', id: 'B-001', to: 'in_review', force }, { actor, now: NOW });

  it('refuses with an empty Handoff, then accepts once it has text', () => {
    const dir = started();
    expect(() => review(dir)).toThrow(Refused);
    expect(() => review(dir)).toThrow(/Handoff/);
    const md = path.join(dir, 'blocks', 'B-001.md');
    writeFileSync(md, readFileSync(md, 'utf8') + '\n  \nDelivered a.md\n');
    expect(review(dir).plan.blocks['B-001']!.status).toBe('in_review');
  });

  it('text under other sections does not count; a missing file or heading is refused', () => {
    const dir = started();
    const md = path.join(dir, 'blocks', 'B-001.md');
    writeFileSync(md, '## Handoff\n\n## Notes\nsome notes\n');
    expect(() => review(dir)).toThrow(/Handoff/);
    writeFileSync(md, '# only a title\n');
    expect(() => checkHandoff(dir, 'B-001')).toThrow(/no ## Handoff/);
    rmSync(md);
    expect(() => review(dir)).toThrow(/Handoff/);
  });

  it('user force bypasses; model force does not', () => {
    const dir = started();
    expect(() => review(dir, MODEL, true)).toThrow();
    expect(review(dir, USER, true).plan.blocks['B-001']!.status).toBe('in_review');
  });
});

describe('ledger rotation on release.add', () => {
  const releaseReady = () => {
    const dir = setup();
    const u = { actor: USER, now: NOW };
    mutate(dir, { type: 'block.add', title: 'A', phase: 'discover' }, ctx);
    mutate(dir, { type: 'gate.approve', gate: 'route' }, u);
    mutate(dir, { type: 'gate.approve', gate: 'release' }, u);
    return dir;
  };

  it('moves events.jsonl to log/<id>.jsonl and continues seq', () => {
    const dir = releaseReady();
    const before = readEvents(dir).length;
    mutate(dir, { type: 'release.add', version: '0.1.0', commit: 'abc', blocks: ['B-001'] }, ctx);
    expect(readFileSync(path.join(dir, 'events.jsonl'), 'utf8')).toBe('');
    const rotated = readFileSync(path.join(dir, 'log', 'REL-1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rotated).toHaveLength(before + 1);
    expect(rotated.at(-1)).toMatchObject({ type: 'release', seq: before + 1 });

    mutate(dir, { type: 'block.add', title: 'B', phase: 'discover' }, ctx);
    expect(readEvents(dir).map((e) => e.seq)).toEqual([before + 2]);
    const all = readAllEvents(dir).map((e) => e.seq);
    expect(all).toEqual(Array.from({ length: before + 2 }, (_, i) => i + 1));
  });

  it('a second release rotates to its own file and ordering is by release number', () => {
    const dir = releaseReady();
    mutate(dir, { type: 'release.add', version: '0.1.0', commit: 'a', blocks: [] }, ctx);
    mutate(dir, { type: 'release.add', version: '0.1.1', commit: 'b', blocks: [] }, ctx);
    expect(existsSync(path.join(dir, 'log', 'REL-2.jsonl'))).toBe(true);
    const seqs = readAllEvents(dir).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });
});

describe('main worktree resolution', () => {
  it('parseMainWorktree takes the first non-bare entry', () => {
    expect(parseMainWorktree('worktree /a/b\nHEAD x\nbranch y\n\nworktree /a/c\nHEAD z\n')).toBe('/a/b');
    expect(parseMainWorktree('worktree /bare.git\nbare\n\nworktree /bare/main\nHEAD z\n')).toBe('/bare/main');
    expect(parseMainWorktree('worktree /with space/x\nHEAD z\n')).toBe('/with space/x');
    expect(parseMainWorktree('')).toBeUndefined();
  });

  const real = (p: string) => spawnSync('realpath', [p], { encoding: 'utf8' }).stdout.trim();
  const sh = (args: string[], cwd: string) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  it('from a subdirectory of a linked worktree, driver and gate-check use the main worktree', () => {
    const d = tmp();
    const main = path.join(d, 'main');
    const wt = path.join(d, 'wt');
    mkdirSync(main);
    sh(['init', '-q', '-b', 'main'], main);
    sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'], main);
    sh(['worktree', 'add', '-q', wt], main);
    mkdirSync(path.join(wt, 'sub', 'deep'), { recursive: true });
    expect(real(resolveProjectRoot(path.join(wt, 'sub', 'deep')))).toBe(real(main));

    // main has the live plan (release gate unapproved); the worktree holds a stale approved copy
    const live = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'hook-project', '.claude', 'driver', 'plan.json'), 'utf8'));
    const stale = structuredClone(live);
    stale.gates.release.approved = true;
    for (const [root, plan] of [[main, live], [wt, stale]] as const) {
      mkdirSync(path.join(root, '.claude', 'driver'), { recursive: true });
      writeFileSync(path.join(root, '.claude', 'driver', 'plan.json'), JSON.stringify(plan));
    }
    const input = JSON.stringify({ cwd: path.join(wt, 'sub'), tool_input: { prompt: 'DRIVER-BLOCK: B-007' } });
    const bash = spawnSync('bash', [path.join(__dirname, '..', 'hooks', 'gate-check.sh')], { input, encoding: 'utf8' });
    expect(bash.stdout).toContain('"permissionDecision": "deny"');
    const node = spawnSync('node', [CLI, 'hook', 'gate-check'], { input, encoding: 'utf8' });
    expect(node.stdout).toContain('"permissionDecision":"deny"');
  });

  it('inside a submodule the root is the submodule working tree, not .git/modules', () => {
    const d = tmp();
    const sub = path.join(d, 'subrepo');
    const sup = path.join(d, 'super');
    const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
    mkdirSync(sub);
    sh(['init', '-q', '-b', 'main'], sub);
    sh([...id, 'commit', '-q', '--allow-empty', '-m', 'i'], sub);
    mkdirSync(sup);
    sh(['init', '-q', '-b', 'main'], sup);
    sh([...id, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'mod'], sup);
    const inner = path.join(sup, 'mod');
    expect(real(resolveProjectRoot(inner))).toBe(real(inner));
    const r = spawnSync('node', [CLI, '--cwd', inner, 'init', 'demo'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(inner, '.claude', 'driver', 'plan.json'))).toBe(true);
    expect(existsSync(path.join(sup, '.git', 'modules'))).toBe(true);
    expect(spawnSync('find', [path.join(sup, '.git'), '-name', 'plan.json'], { encoding: 'utf8' }).stdout.trim()).toBe('');

    // the shell gate-check agrees
    const plan = JSON.parse(readFileSync(path.join(inner, '.claude', 'driver', 'plan.json'), 'utf8'));
    plan.currentPhase = 'release';
    writeFileSync(path.join(inner, '.claude', 'driver', 'plan.json'), JSON.stringify(plan));
    const out = spawnSync('bash', [path.join(__dirname, '..', 'hooks', 'gate-check.sh')], {
      input: JSON.stringify({ cwd: inner, tool_input: {} }),
      encoding: 'utf8',
    });
    expect(out.stdout).toContain('gate route');
  });

  it('DRIVER_ROOT wins over git', () => {
    const d = tmp();
    mkdirSync(path.join(d, '.claude', 'driver'), { recursive: true });
    writeFileSync(path.join(d, '.claude', 'driver', 'plan.json'), '{ corrupt');
    const input = JSON.stringify({ cwd: tmp(), tool_input: {} });
    const env = { ...process.env, DRIVER_ROOT: d };
    expect(spawnSync('bash', [path.join(__dirname, '..', 'hooks', 'gate-check.sh')], { input, env, encoding: 'utf8' }).stdout).toContain('deny');
    expect(spawnSync('node', [CLI, 'hook', 'gate-check'], { input, env, encoding: 'utf8' }).stdout).toContain('deny');
  });
});
