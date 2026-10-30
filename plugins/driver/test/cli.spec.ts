import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mutate } from '../src/store.js';
import { CLI, EXAMPLES, NOW, PKG_ROOT, USER, approveAsUser, loadFixture, runCli, runGateSh, tmp, writePlanFile } from './helpers.js';

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error('dist/cli.js missing: run `npm run build` (npm test does it via pretest)');
});

const examples = ['web-waitlist', 'video-explainer'];

describe('validate', () => {
  it.each(examples)('passes on example %s, including --replay', (name) => {
    const dir = path.join(EXAMPLES, name);
    expect(runCli(['validate', dir]).status).toBe(0);
    const r = runCli(['validate', dir, '--replay']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ok');
  });

  it('--replay fails on a tampered copy', () => {
    const copy = tmp();
    cpSync(path.join(EXAMPLES, 'web-waitlist'), copy, { recursive: true });
    const file = path.join(copy, '.claude', 'driver', 'plan.json');
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    plan.blocks['B-003'].status = 'in_progress'; // ledger says done
    plan.blocks['B-003'].owner = 'x';
    writeFileSync(file, JSON.stringify(plan));
    expect(runCli(['validate', copy]).status).toBe(0); // snapshot alone is still valid
    const r = runCli(['validate', copy, '--replay']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('replay.mismatch');
    expect(r.stdout).toContain('ledger says done, plan.json says in_progress');
  });

  it('--replay fails on a gap in the ledger sequence', () => {
    const copy = tmp();
    cpSync(path.join(EXAMPLES, 'video-explainer'), copy, { recursive: true });
    const file = path.join(copy, '.claude', 'driver', 'events.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    lines.splice(2, 1);
    writeFileSync(file, `${lines.join('\n')}\n`);
    const r = runCli(['validate', copy, '--replay']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('replay.seq');
  });

  it('exits 1 on invalid plans and reports missing block docs', () => {
    const copy = tmp();
    cpSync(path.join(EXAMPLES, 'video-explainer'), copy, { recursive: true });
    const r0 = runCli(['validate', copy]);
    expect(r0.status).toBe(0);
    rmSync(path.join(copy, '.claude', 'driver', 'blocks', 'B-001.md'));
    const r = runCli(['validate', copy]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('doc.missing');
    const j = runCli(['validate', copy, '--json']);
    expect(JSON.parse(j.stdout).ok).toBe(false);
  });

  it('exit 1 when plan.json is not initialized', () => {
    const r = runCli(['validate', tmp()]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('driver init');
  });
});

describe('validate --replay with rotated ledgers', () => {
  it('folds log/*.jsonl before events.jsonl and catches a missing rotated file', () => {
    const dir = tmp();
    const g = ['--cwd', dir, '--root', dir, '--now', NOW];
    const cli = (...a: string[]) => runCli([...g, ...a]);
    cli('init', 'demo');
    cli('block', 'add', 'A', '--phase', 'discover');
    approveAsUser(dir, 'route');
    approveAsUser(dir, 'release');
    expect(cli('release', 'add', '--version', '0.1.0', '--commit', 'abc').status).toBe(0);
    cli('block', 'add', 'B', '--phase', 'discover');
    const r = cli('validate', '--replay');
    expect(r.status).toBe(0);
    expect(existsSync(path.join(dir, '.claude', 'driver', 'log', 'REL-1.jsonl'))).toBe(true);
    rmSync(path.join(dir, '.claude', 'driver', 'log', 'REL-1.jsonl'));
    const bad = cli('validate', '--replay');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('replay.');
  });
});

describe('status and export', () => {
  it('status summarizes the example', () => {
    const r = runCli(['status', path.join(EXAMPLES, 'web-waitlist')]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        'DRIVER web-waitlist',
        'phase: implement   baseline: 1   revision: 34',
        'gates: route approved (diogo, baseline 1); release not approved',
        'blocks: 8 active (not_started 3, blocked 1, in_review 1, done 3)',
        '',
      ].join('\n'),
    );
    const j = JSON.parse(runCli(['status', path.join(EXAMPLES, 'video-explainer'), '--json']).stdout);
    expect(j).toMatchObject({ currentPhase: 'route', baseline: 1, gates: { route: { approved: true }, release: { approved: false } } });
  });

  it.each(examples)('export mermaid --stdout matches the committed docs/plan.mmd for %s', (name) => {
    const dir = path.join(EXAMPLES, name);
    const r = runCli(['export', 'mermaid', dir, '--stdout']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(readFileSync(path.join(dir, 'docs', 'plan.mmd'), 'utf8'));
  });

  it('export mermaid writes exports/plan.mmd by default', () => {
    const copy = tmp();
    cpSync(path.join(EXAMPLES, 'video-explainer'), copy, { recursive: true });
    const r = runCli(['export', 'mermaid', copy]);
    expect(r.status).toBe(0);
    const out = path.join(copy, '.claude', 'driver', 'exports', 'plan.mmd');
    expect(r.stdout.trim()).toBe(out);
    expect(readFileSync(out, 'utf8')).toMatch(/^flowchart LR\n/);
  });
});

describe('commands and exit codes', () => {
  const setup = () => {
    const dir = tmp();
    const g = ['--cwd', dir, '--root', dir, '--now', NOW];
    const cli = (...a: string[]) => runCli([...g, ...a]);
    expect(cli('init', 'demo').status).toBe(0);
    return { dir, cli };
  };

  it('block add/set/status flow and usage errors', () => {
    const { dir, cli } = setup();
    expect(cli('block', 'add', 'Interview', '--phase', 'discover').stdout.trim()).toBe('B-001');
    expect(cli('block', 'add', 'Plan', '--phase', 'route', '--depends', 'B-001').stdout.trim()).toBe('B-002');
    expect(cli('block', 'add', 'x').status).toBe(2); // --phase missing
    expect(cli('block', 'add', 'x', '--phase', 'nope').status).toBe(2);
    expect(cli('bogus').status).toBe(2);
    expect(cli('block', 'status', 'B-001', 'done').status).toBe(1); // illegal transition
    expect(cli('block', 'status', 'B-001', 'in_progress').status).toBe(0);
    expect(cli('block', 'status', 'B-001', 'in_review').status).toBe(1); // no artifacts
    expect(cli('block', 'set', 'B-001', '--add-artifact', 'a.md', '--test', 'a:b.ts:unit:pass').status).toBe(0);
    expect(cli('block', 'status', 'B-001', 'in_review').status).toBe(1); // empty Handoff
    appendFileSync(path.join(dir, '.claude', 'driver', 'blocks', 'B-001.md'), 'Done, see a.md\n');
    expect(cli('block', 'status', 'B-001', 'in_review').status).toBe(0);
    expect(cli('block', 'status', 'B-001', 'done').status).toBe(1); // not verified
    expect(cli('--actor', 'user:diogo', 'block', 'set', 'B-001', '--verified', 'true').status).toBe(0);
    expect(cli('block', 'status', 'B-001', 'done').status).toBe(0);
    const plan = JSON.parse(readFileSync(path.join(path.dirname(cli('export', 'mermaid').stdout.trim()), '..', 'plan.json'), 'utf8'));
    expect(plan.blocks['B-001'].tests[0]).toMatchObject({ ref: 'a:b.ts', layer: 'unit', result: 'pass' });
  });

  it('gate approve, rebaseline and --force refuse without a terminal (exit 2), whatever --actor says', () => {
    const { dir, cli } = setup();
    for (const args of [
      ['gate', 'approve', 'route'],
      ['--actor', 'user:diogo', 'gate', 'approve', 'route'],
      ['--actor', 'hook:x', 'gate', 'approve', 'route'],
      ['--actor', 'user:diogo', 'rebaseline', '--reason', 'x'],
      ['--actor', 'user:diogo', 'block', 'status', 'B-001', 'in_progress', '--force'],
    ]) {
      const r = cli(...args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toContain('requires an interactive terminal; run this in your own terminal');
    }
    const r = runCli(['--cwd', dir, '--root', dir, 'gate', 'approve', 'route'], { env: { DRIVER_ACTOR: 'user:diogo' } });
    expect(r.status).toBe(2);
    expect(JSON.parse(readFileSync(path.join(dir, '.claude', 'driver', 'plan.json'), 'utf8')).gates.route.approved).toBe(false);
  });

  it('gate flow after a user approval', () => {
    const { dir, cli } = setup();
    expect(cli('phase', 'advance').status).toBe(1);
    approveAsUser(dir, 'route');
    expect(cli('phase', 'advance').status).toBe(0);
    expect(cli('phase', 'back', 'discover', '--reason', 'again').status).toBe(0);
    const s = JSON.parse(cli('status', '--json').stdout);
    expect(s).toMatchObject({ currentPhase: 'discover', gates: { route: { approved: false } } });
  });

  const hasScript = existsSync('/usr/bin/script');
  it.skipIf(!hasScript)('a typed "yes" on a pty approves the gate as a user (script)', () => {
    const { dir } = setup();
    const cmd = `(sleep 1; echo yes; sleep 1) | script -q /dev/null node "${CLI}" --cwd "${dir}" --root "${dir}" --actor user:diogo gate approve route`;
    const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
    expect(r.stdout).toContain('D-001');
    const plan = JSON.parse(readFileSync(path.join(dir, '.claude', 'driver', 'plan.json'), 'utf8'));
    expect(plan.gates.route).toMatchObject({ approved: true, approvedBy: 'diogo' });
    expect(plan.decisions['D-001']).toMatchObject({ by: { kind: 'user', id: 'diogo' } });
  }, 30_000);

  it.skipIf(!hasScript)('anything but "yes" on the pty does not approve', () => {
    const { dir } = setup();
    const cmd = `(sleep 1; echo no; sleep 1) | script -q /dev/null node "${CLI}" --cwd "${dir}" --root "${dir}" gate approve route`;
    spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
    expect(JSON.parse(readFileSync(path.join(dir, '.claude', 'driver', 'plan.json'), 'utf8')).gates.route.approved).toBe(false);
  }, 30_000);

  it('decisions: decision add, then retire before Gate 1', () => {
    const { cli } = setup();
    cli('req', 'add', 'Join', '--kind', 'functional', '--source', 'user');
    cli('block', 'add', 'A', '--phase', 'discover', '--req', 'R-001');
    expect(cli('block', 'retire', 'B-001', '--decision', 'D-009', '--reason', 'x').status).toBe(1);
    expect(cli('decision', 'add', '--title', 'Drop A', '--reason', 'out of scope').stdout.trim()).toBe('D-001');
    expect(cli('block', 'retire', 'B-001', '--decision', 'D-001', '--reason', 'out of scope').status).toBe(0);
    expect(cli('req', 'retire', 'R-001', '--decision', 'D-001', '--reason', 'out of scope').status).toBe(0);
  });

  it('req, rebaseline, release and renumber', () => {
    const { dir, cli } = setup();
    expect(cli('req', 'add', 'Join', '--kind', 'functional', '--source', 'user').stdout.trim()).toBe('R-001');
    cli('block', 'add', 'Interview', '--phase', 'discover', '--req', 'R-001');
    approveAsUser(dir, 'route');
    cli('phase', 'advance');
    expect(cli('req', 'add', 'Late', '--kind', 'functional', '--source', 'user').stdout.trim()).toBe('R-002'); // allowed in implement
    mutate(path.join(dir, '.claude', 'driver'), { type: 'rebaseline', reason: 'scope' }, { actor: USER, now: NOW });
    expect(cli('release', 'add', '--version', '0.1.0', '--commit', 'abc').status).toBe(1); // release gate not approved
    expect(cli('renumber').stdout.trim()).toBe('nothing to renumber');
    expect(JSON.parse(cli('--json', 'status').stdout).baseline).toBe(2);
  });

  it('--json prints machine-readable errors', () => {
    const { cli } = setup();
    const r = cli('--json', 'block', 'status', 'B-404', 'done');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stderr)).toEqual({ ok: false, error: 'unknown block B-404' });
  });
});

describe('hook gate-check (bash script and node implementation agree)', () => {
  const impls = {
    bash: (input: string) => runGateSh(input).stdout,
    node: (input: string) => runCli(['hook', 'gate-check'], { input }).stdout,
  };
  const input = (cwd: string, prompt = 'DRIVER-BLOCK: B-007\nDeploy') =>
    JSON.stringify({ cwd, tool_name: 'Agent', tool_input: { description: 'd', prompt } });
  const decision = (out: string): 'allow' | 'deny' => {
    if (out.trim() === '') return 'allow';
    const j = JSON.parse(out);
    expect(j.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(j.hookSpecificOutput.permissionDecisionReason).toMatch(/^DRIVER/);
    return 'deny';
  };

  describe.each(Object.entries(impls))('%s', (_name, run) => {
    it('no plan -> allow', () => {
      expect(decision(run(input(tmp())))).toBe('allow');
    });

    it('SendMessage is gated like a spawn, by the message', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'mid-implement');
      plan.gates.route.approved = false;
      writePlanFile(d, plan);
      const msg = JSON.stringify({ cwd: d, tool_name: 'SendMessage', tool_input: { to: 'a1', message: 'DRIVER-BLOCK: B-003 continue' } });
      expect(decision(run(msg))).toBe('deny');
      plan.gates.route.approved = true;
      writePlanFile(d, plan);
      expect(decision(run(msg))).toBe('allow');
    });

    it('release unapproved, block in release phase -> deny', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'mid-implement');
      plan.currentPhase = 'evolve';
      writePlanFile(d, plan);
      const out = run(input(d));
      expect(decision(out)).toBe('deny');
      expect(out).toContain('gate release');
    });

    it('currentPhase release with the gate unapproved -> deny without marker', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'mid-implement');
      plan.currentPhase = 'release';
      writePlanFile(d, plan);
      expect(decision(run(input(d, 'no marker here')))).toBe('deny');
    });

    it('release approved -> allow', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'mid-implement');
      plan.currentPhase = 'evolve';
      plan.gates.release.approved = true;
      writePlanFile(d, plan);
      expect(decision(run(input(d)))).toBe('allow');
    });

    it('discover phase -> allow even with the route gate unapproved', () => {
      const d = tmp();
      writePlanFile(d, loadFixture('valid', 'minimal-discover'));
      expect(decision(run(input(d, 'plain prompt')))).toBe('allow');
    });

    it('marker pointing at a later-phase block denies while route is unapproved', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'minimal-discover');
      plan.blocks['B-009'] = { ...loadFixture('valid', 'mid-implement').blocks['B-003'], status: 'not_started' };
      writePlanFile(d, plan);
      expect(decision(run(input(d, 'DRIVER-BLOCK: B-009')))).toBe('deny');
      expect(decision(run(input(d, 'DRIVER-BLOCK: B-404')))).toBe('allow'); // unknown block -> currentPhase
    });

    it('marker is read from description when there is no prompt', () => {
      const d = tmp();
      const plan = loadFixture('valid', 'mid-implement');
      plan.currentPhase = 'evolve';
      writePlanFile(d, plan);
      const i = JSON.stringify({ cwd: d, tool_input: { description: 'DRIVER-BLOCK: B-007' } });
      expect(decision(run(i))).toBe('deny');
    });

    it('corrupt plan.json -> deny (fail closed)', () => {
      const d = tmp();
      writePlanFile(d, '{ not json');
      expect(decision(run(input(d)))).toBe('deny');
    });

    it('plan.json that is not an object -> deny', () => {
      const d = tmp();
      writePlanFile(d, '[]');
      expect(decision(run(input(d)))).toBe('deny');
    });

    it('Workflow input without prompt falls back to currentPhase', () => {
      const d = tmp();
      writePlanFile(d, loadFixture('valid', 'mid-implement')); // implement, route approved
      expect(decision(run(JSON.stringify({ cwd: d, tool_name: 'Workflow', tool_input: { script: 'x' } })))).toBe('allow');
    });
  });

  it('the static fixture from the plan denies when run from the package root', () => {
    const r = spawnSync('bash', [path.join(PKG_ROOT, 'hooks', 'gate-check.sh')], {
      cwd: PKG_ROOT,
      // the repository's own plan (dogfooding) would win over the fixture's otherwise
      env: { ...process.env, DRIVER_ROOT: path.join(PKG_ROOT, 'test', 'fixtures', 'hook-project') },
      input: readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'hook-input-release-unapproved.json'), 'utf8'),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('hook protect-plan', () => {
  // the guard only applies where a plan exists
  const proj = tmp();
  writePlanFile(proj, loadFixture('valid', 'mid-implement'));
  const run = (tool_name: string, tool_input: object, cwd = proj) =>
    runCli(['hook', 'protect-plan'], { input: JSON.stringify({ tool_name, tool_input, cwd }) });

  it('no plan -> allow everything, pty wrappers included', () => {
    const none = tmp();
    expect(run('Bash', { command: 'socat TCP-LISTEN:1 TCP:localhost:2' }, none).stdout.trim()).toBe('');
    expect(run('Write', { file_path: '/p/.claude/driver/plan.json' }, none).stdout.trim()).toBe('');
  });
  const denied = (r: ReturnType<typeof run>) => {
    expect(r.status).toBe(0);
    return r.stdout.trim() !== '' && JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === 'deny';
  };

  it.each([
    ['Write', '/p/.claude/driver/plan.json'],
    ['Edit', '/p/.claude/driver/plan.json'],
    ['MultiEdit', '/p/.claude/driver/events.jsonl'],
  ])('%s to %s -> deny', (tool, file_path) => {
    expect(denied(run(tool, { file_path }))).toBe(true);
  });

  it('other files -> allow', () => {
    expect(denied(run('Write', { file_path: '/p/.claude/driver/blocks/B-001.md' }))).toBe(false);
    expect(denied(run('Write', { file_path: '/p/src/plan.json' }))).toBe(false);
    expect(denied(run('Edit', { file_path: '/p/other/events.jsonl' }))).toBe(false);
  });

  it.each([
    'driver gate approve route',
    'node plugins/driver/dist/cli.js gate approve release',
    'cd x && driver --actor user:diogo   gate approve route',
  ])('Bash %s -> deny', (command) => {
    expect(denied(run('Bash', { command }))).toBe(true);
  });

  it.each([
    'echo {} > .claude/driver/plan.json',
    'echo x >> /p/.claude/driver/events.jsonl',
    "sed -i '' s/a/b/ .claude/driver/plan.json",
    'jq .revision=9 .claude/driver/plan.json > t && mv t .claude/driver/plan.json',
    'tee .claude/driver/events.jsonl < x',
    'cp /tmp/x .claude/driver/plan.json',
    'rm .claude/driver/events.jsonl',
    'truncate -s 0 .claude/driver/events.jsonl',
    // review bypasses
    'cd .claude/driver && echo {} > plan.json',
    'cd .claude/driver && cp /tmp/x plan.json',
    `node -e "require('fs').writeFileSync('.claude/driver/plan.json','{}')"`,
    `python3 -c "open('.claude/driver/plan.json','w').write('{}')"`,
    'git checkout -- .claude/driver/plan.json',
    'git restore .claude/driver/plan.json',
    'jq . x | sponge .claude/driver/plan.json',
    'dd if=/tmp/x of=.claude/driver/plan.json',
    'echo {} > .claude/./driver/plan.json',
    'echo {} > .claude//driver/plan.json',
    'echo {} > ".claude/driver"/plan.json',
    'echo {} > .claude/dri\\ver/plan.json',
    'rm .claude/driver/log/REL-1.jsonl',
    'perl -e 1 .claude/driver/plan.json',
  ])('Bash write %s -> deny', (command) => {
    expect(denied(run('Bash', { command }))).toBe(true);
  });

  it.each([
    'driver gate "approve" route --actor user:me',
    "driver gate 'approve' route",
    'A=approve; driver gate $A route',
    'cd plugins/driver/dist && node cli.js gate approve route',
    'driver rebaseline --reason x',
    'driver block status B-003 in_progress --force',
    'node dist/cli.js block status B-003 in_progress "--force"',
    'driver gate $(echo approve) route',
    'script -q /dev/null driver gate approve route',
    'expect -c "spawn node dist/cli.js foo"',
    'python3 -c "import pty; pty.spawn([\'driver\'])" driver',
  ])('Bash user-only bypass %s -> deny', (command) => {
    expect(denied(run('Bash', { command }))).toBe(true);
  });

  it.each([
    '(sleep 1; echo yes; sleep 2) | script -q /dev/null bash x.sh',
    'script -q /dev/null bash x.sh',
    'nohup script -q /dev/null ls',
    'expect x.exp',
    'unbuffer ls',
    'socat - EXEC:ls,pty',
    `python3 -c 'import pty; pty.spawn(["bash","x.sh"])'`,
    `python3 -c 'import os; os.openpty()'`,
    'cc forkpty.c',
  ])('Bash pty wrapper %s -> deny, even without driver', (command) => {
    const r = run('Bash', { command });
    expect(denied(r)).toBe(true);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain('pseudo-terminal wrappers are not allowed');
  });

  it.each([
    'cd .claude/driver && ln -sf /tmp/evil.json plan.json',
    'ln -s /tmp/evil.json .claude/driver/plan.json',
    'rsync /tmp/p.json .claude/driver/plan.json',
    'cd .claude/dr*r && cp /tmp/p.json pl*.json',
    'cp /tmp/p.json .claude/d?iver/plan.json',
    'cp /tmp/p.json .claude/[d]river/plan.json',
  ])('Bash ln/rsync/glob %s -> deny', (command) => {
    expect(denied(run('Bash', { command }))).toBe(true);
  });

  it.each([
    'npm run scripts',
    './scripts/build.sh',
    'node scripts/gen-json-schema.ts',
    'bash scripts/x.sh',
    'ls .claude/*',
    'rsync -a src/ /tmp/backup/',
    'ln -s src lib',
  ])('Bash %s -> allow', (command) => {
    expect(denied(run('Bash', { command }))).toBe(false);
  });

  it.each([
    ['Write', '/p/.claude/driver/./plan.json'],
    ['Write', '/p/.claude//driver/plan.json'],
    ['Edit', '/p/x/../.claude/driver/events.jsonl'],
    ['Write', '/p/.claude/driver/log/REL-1.jsonl'],
  ])('%s to %s -> deny (normalized)', (tool, file_path) => {
    expect(denied(run(tool, { file_path }))).toBe(true);
  });

  it.each([
    'cat .claude/driver/plan.json',
    'jq .revision .claude/driver/plan.json',
    'jq . .claude/driver/plan.json 2>/dev/null',
    'cat .claude/driver/plan.json 2>&1 | head',
    'grep B-001 .claude/driver/events.jsonl | head',
    'grep -n "rm" .claude/driver/events.jsonl',
    'git add .claude/driver',
    'git diff .claude/driver/plan.json',
    'git status',
    'git log --oneline -- .claude/driver',
    'cp .claude/driver/plan.json /tmp/b.json',
    'driver block set B-001 --add-artifact .claude/driver/plan.json',
    'node plugins/driver/dist/cli.js validate --replay 2>&1',
    'node plugins/driver/dist/cli.js block add "T" --phase discover',
    'node build.js',
  ])('Bash read-only %s -> allow', (command) => {
    expect(denied(run('Bash', { command }))).toBe(false);
  });

  it.each(['driver status', 'driver gate revoke route --reason x', 'git status', 'echo gate approve'])(
    'Bash %s -> allow',
    (command) => {
      expect(denied(run('Bash', { command }))).toBe(false);
    },
  );

  it('garbage input -> allow, exit 0', () => {
    const r = runCli(['hook', 'protect-plan'], { input: 'not json' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('platform agent ids (--owner)', () => {
  it('orphans a block claimed under the platform agent id, falling back to cwd for the plan', () => {
    const dir = tmp();
    const g = ['--cwd', dir, '--root', dir, '--now', NOW];
    const cli = (...a: string[]) => runCli([...g, ...a]);
    cli('init', 'demo');
    cli('block', 'add', 'A', '--phase', 'discover');
    expect(cli('block', 'status', 'B-001', 'in_progress', '--owner', 'plat-42').status).toBe(0);
    expect(cli('block', 'status', 'B-001', 'blocked', '--owner', 'x', '--reason', 'r').status).toBe(2); // --owner only for in_progress
    const file = path.join(dir, '.claude', 'driver', 'plan.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).blocks['B-001'].owner).toBe('plat-42');
    runCli(['hook', 'subagent-stop'], { input: JSON.stringify({ agent_id: 'main', cwd: dir }) });
    expect(JSON.parse(readFileSync(file, 'utf8')).blocks['B-001'].status).toBe('in_progress');
    runCli(['hook', 'subagent-stop'], { input: JSON.stringify({ agent_id: 'plat-42', cwd: path.join(dir, 'nowhere') }), env: { DRIVER_ROOT: dir } });
    expect(JSON.parse(readFileSync(file, 'utf8')).blocks['B-001']).toMatchObject({ status: 'blocked', statusBy: { kind: 'hook' } });
  });
});

describe('hook subagent-stop', () => {
  const setup = () => {
    const dir = tmp();
    const g = ['--cwd', dir, '--root', dir, '--now', NOW];
    const cli = (...a: string[]) => runCli([...g, ...a]);
    cli('init', 'demo');
    cli('block', 'add', 'A', '--phase', 'discover');
    cli('block', 'add', 'B', '--phase', 'discover');
    cli('--actor', 'model:agent-1', 'block', 'status', 'B-001', 'in_progress');
    cli('--actor', 'model:agent-2', 'block', 'status', 'B-002', 'in_progress');
    const planFile = path.join(dir, '.claude', 'driver', 'plan.json');
    return { dir, cli, planFile, read: () => JSON.parse(readFileSync(planFile, 'utf8')) };
  };

  it('moves the stopped agent\'s in_progress block to blocked', () => {
    const { dir, read } = setup();
    const r = runCli(['hook', 'subagent-stop'], { input: JSON.stringify({ agent_id: 'agent-1', cwd: dir }) });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const plan = read();
    expect(plan.blocks['B-001']).toMatchObject({
      status: 'blocked',
      statusReason: 'agent ended without handoff',
      statusBy: { kind: 'hook', id: 'subagent-stop' },
    });
    expect(plan.blocks['B-001'].owner).toBeUndefined();
    expect(plan.blocks['B-002'].status).toBe('in_progress');
    const events = readFileSync(path.join(dir, '.claude', 'driver', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.slice(-2).map((e: any) => e.type)).toEqual(['block.status', 'orphan']);
  });

  it('does nothing (no revision bump) when the agent owns nothing, has no id, or input is garbage', () => {
    const { dir, read } = setup();
    const rev = read().revision;
    for (const input of [JSON.stringify({ agent_id: 'ghost', cwd: dir }), JSON.stringify({ cwd: dir }), 'garbage', '']) {
      const r = runCli(['hook', 'subagent-stop'], { input });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
    expect(read().revision).toBe(rev);
  });

  it('never fails outside a DRIVER project', () => {
    const r = runCli(['hook', 'subagent-stop'], { input: JSON.stringify({ agent_id: 'a', cwd: tmp() }) });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
