import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DiscoverRefusedError, frontier, logDiscover, readState } from '../src/discover-log.js';
import { initDriverDir } from '../src/store.js';
import { CLI, runCli, tmp } from './helpers.js';

const NOW = '2026-11-10T10:00:00Z';
let root: string;
let dir: string;
const f = (name: string): string => path.join(dir, 'discover', name);
const read = (name: string): string => readFileSync(f(name), 'utf8');
const log = (input: unknown, now = NOW) => logDiscover(dir, input, now);

beforeEach(() => {
  root = tmp();
  dir = path.join(root, '.claude', 'driver');
  initDriverDir(dir, 'demo', [], NOW);
});

describe('ids and upsert', () => {
  it('assigns Q-nn and N-nn in creation order, with two digits', () => {
    const r = log({
      nodes: [
        { question: 'Who is it for?', kind: 'decision' },
        { question: 'Which framework?', kind: 'fact' },
      ],
      nonGoals: [{ statement: 'No admin dashboard' }],
    });
    expect(r.created.nodes).toEqual(['Q-01', 'Q-02']);
    expect(r.created.nonGoals).toEqual(['N-01']);
    expect(log({ nodes: [{ question: 'More?', kind: 'fact' }] }).created.nodes).toEqual(['Q-03']);
  });

  it('grows to three digits past 99', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({ question: `q${i}`, kind: 'fact' }));
    const r = log({ nodes });
    expect(r.created.nodes[98]).toBe('Q-99');
    expect(r.created.nodes[99]).toBe('Q-100');
  });

  it('keeps absent fields on update and defaults status open and area core', () => {
    log({ nodes: [{ question: 'Q?', kind: 'decision', options: ['a', 'b'], area: 'data' }] });
    expect(readState(dir).state.nodes[0]).toMatchObject({ status: 'open', area: 'data' });
    log({ nodes: [{ id: 'Q-01', answer: 'a', status: 'settled', source: 'user' }] }, '2026-11-10T11:00:00Z');
    const n = readState(dir).state.nodes[0]!;
    expect(n).toMatchObject({ question: 'Q?', kind: 'decision', options: ['a', 'b'], area: 'data', answer: 'a', status: 'settled', source: 'user', at: '2026-11-10T11:00:00Z' });
    log({ nodes: [{ question: 'x', kind: 'fact' }] });
    expect(readState(dir).state.nodes[0]!.question).toBe('Q?');
    expect(readState(dir).state.nodes[0]!.area).toBe('data');
    expect(readState(dir).state.nodes[1]!.area).toBe('core');
  });

  it('keeps meta keys that are absent', () => {
    log({ meta: { goal: 'Waitlist', class: 'S', domain: 'web' } });
    log({ meta: { stage: 'areas', chosenAreas: ['data'] } });
    expect(readState(dir).state.meta).toMatchObject({ goal: 'Waitlist', class: 'S', domain: 'web', stage: 'areas', chosenAreas: ['data'], reclassified: false, checkpoint: 'none' });
  });

  it('refuses to create without question or kind, an unknown id and unknown keys', () => {
    expect(() => log({ nodes: [{ kind: 'fact' }] })).toThrow(/needs a question/);
    expect(() => log({ nodes: [{ question: 'x' }] })).toThrow(/needs a kind/);
    expect(() => log({ nodes: [{ id: 'Q-09', answer: 'x' }] })).toThrow(/unknown id Q-09/);
    expect(() => log({ nodes: [{ question: 'x', kind: 'fact', colour: 'red' }] })).toThrow(/colour/);
    expect(() => log({ other: 1 })).toThrow(DiscoverRefusedError);
    expect(() => log({})).toThrow(/at least one/);
  });
});

describe('validation', () => {
  it('refuses assumed without why, accepts it when why is stored or given', () => {
    log({ nodes: [{ question: 'Where to host?', kind: 'decision' }] });
    expect(() => log({ nodes: [{ id: 'Q-01', status: 'assumed' }] })).toThrow(/needs a why/);
    log({ nodes: [{ id: 'Q-01', why: 'default' }] });
    expect(log({ nodes: [{ id: 'Q-01', status: 'assumed' }] }).created.assumptions).toEqual(['A-01']);
    expect(() => log({ nodes: [{ question: 'x', kind: 'fact', status: 'assumed', why: '  ' }] })).toThrow(/needs a why/);
  });

  it('refuses unknown dependsOn, self dependency and cycles; same-call ids count', () => {
    expect(() => log({ nodes: [{ question: 'x', kind: 'fact', dependsOn: ['Q-07'] }] })).toThrow(/Q-07 does not exist/);
    const r = log({
      nodes: [
        { question: 'a', kind: 'fact' },
        { question: 'b', kind: 'fact', dependsOn: ['Q-01'] },
      ],
    });
    expect(r.created.nodes).toEqual(['Q-01', 'Q-02']);
    expect(() => log({ nodes: [{ id: 'Q-01', dependsOn: ['Q-01'] }] })).toThrow(/itself/);
    expect(() => log({ nodes: [{ id: 'Q-01', dependsOn: ['Q-02'] }] })).toThrow(/cycle/);
  });

  it('a refused call changes nothing: jsonl and rendered files stay byte for byte', () => {
    log({ meta: { goal: 'g' }, nodes: [{ question: 'a', kind: 'fact', answer: 'x', status: 'settled' }], nonGoals: [{ statement: 'n' }] });
    const before = ['interview.jsonl', 'interview.md', 'assumptions.md', 'non-goals.md'].map(read);
    expect(() =>
      log({ meta: { stage: 'closed' }, nodes: [{ question: 'ok', kind: 'fact' }, { id: 'Q-01', status: 'assumed' }], nonGoals: [{ statement: 'later' }] }),
    ).toThrow(DiscoverRefusedError);
    expect(['interview.jsonl', 'interview.md', 'assumptions.md', 'non-goals.md'].map(read)).toEqual(before);
    expect(readdirSync(path.join(dir, 'discover')).sort()).toEqual(['.gitkeep', 'assumptions.md', 'interview.jsonl', 'interview.md', 'non-goals.md']);
  });

  it('needs an initialized plan', () => {
    expect(() => logDiscover(path.join(tmp(), '.claude', 'driver'), { meta: {} }, NOW)).toThrow(/no plan/);
  });
});

describe('frontier and assumptions', () => {
  it('lists open nodes whose dependencies are settled or assumed', () => {
    log({
      nodes: [
        { question: 'a', kind: 'fact' },
        { question: 'b', kind: 'fact', dependsOn: ['Q-01'] },
        { question: 'c', kind: 'decision', dependsOn: ['Q-01', 'Q-02'] },
        { question: 'd', kind: 'decision' },
      ],
    });
    expect(frontier(readState(dir).state).map((n) => n.id)).toEqual(['Q-01', 'Q-04']);
    log({ nodes: [{ id: 'Q-01', status: 'settled', answer: 'yes' }] });
    expect(frontier(readState(dir).state).map((n) => n.id)).toEqual(['Q-02', 'Q-04']);
    const r = log({ nodes: [{ id: 'Q-02', status: 'assumed', why: 'safe default' }, { id: 'Q-04', status: 'deferred' }] });
    expect(r.frontier.map((n) => n.id)).toEqual(['Q-03']);
  });

  it('keeps A-nn stable across updates and numbers new ones after it', () => {
    log({ nodes: [{ question: 'a', kind: 'decision', status: 'assumed', why: 'w1' }, { question: 'b', kind: 'decision', status: 'assumed', why: 'w2' }] });
    expect(readState(dir).state.nodes.map((n) => n.assumption)).toEqual(['A-01', 'A-02']);
    log({ nodes: [{ id: 'Q-01', why: 'w1 revised' }] });
    log({ nodes: [{ id: 'Q-01', status: 'settled', answer: 'user chose' }] });
    log({ nodes: [{ id: 'Q-01', status: 'assumed' }] });
    log({ nodes: [{ question: 'c', kind: 'decision', status: 'assumed', why: 'w3' }] });
    expect(readState(dir).state.nodes.map((n) => n.assumption)).toEqual(['A-01', 'A-02', 'A-03']);
  });
});

describe('rendered files', () => {
  beforeEach(() => {
    log({
      meta: { goal: 'Collect sign-ups', class: 'S', domain: 'web', language: 'en', areas: ['hosting', 'data'], chosenAreas: ['data'] },
      nodes: [
        { question: 'Who is it for?', kind: 'decision', status: 'settled', answer: 'Indie makers', source: 'user', options: ['Makers', 'Teams'] },
        { question: 'Where to store a | b?', kind: 'decision', area: 'data', dependsOn: ['Q-01'], status: 'assumed', answer: 'Supabase', source: 'assumed', why: 'credentials exist' },
        { question: 'Confirmation email?', kind: 'decision', dependsOn: ['Q-01'] },
      ],
      nonGoals: [{ statement: 'No admin dashboard', reason: 'read the DB directly' }, { statement: 'No payments' }],
    });
  });

  it('renders interview.md with frontmatter, table and log', () => {
    const md = read('interview.md');
    expect(md.startsWith('---\nclass: S\ndomain: web\nlanguage: en\nstage: core\nstatus: open\nareas: hosting, data\nchosenAreas: data\nreclassified: no\naccepted: no\ncheckpoint: none\nbatch-applied: -\n---\n<!-- Generated from interview.jsonl by `driver discover log`. Do not edit by hand. -->')).toBe(true);
    expect(md).toContain('# Discovery interview\n\nGoal: Collect sign-ups');
    expect(md).toContain('| id | question | area | dependsOn | kind | status | answer | source |');
    expect(md).toContain('| Q-01 | Who is it for? | core | - | decision | settled | Indie makers | user |');
    expect(md).toContain('| Q-03 | Confirmation email? | core | Q-01 | decision | open |  |  |');
    expect(md).toContain('## Log\n\n**Q-01** (2026-11-10T10:00:00Z)\nQuestion: Who is it for?\nOptions shown: Makers / Teams\nAnswer: Indie makers');
    expect(md).not.toContain('**Q-03**');
  });

  it('escapes | inside table cells', () => {
    expect(read('interview.md')).toContain('| Q-02 | Where to store a \\| b? | data | Q-01 | decision | assumed | Supabase | assumed |');
  });

  it('renders assumptions.md and flips Accepted to yes once the stage is closed', () => {
    const md = read('assumptions.md');
    expect(md).toContain('<!-- Generated from interview.jsonl');
    expect(md).toContain('# Assumptions\n\n## A-01 Supabase\n\n- Why assumed: credentials exist\n- Source node: Q-02\n- Accepted: pending\n- Requirement: -');
    log({ nodes: [{ id: 'Q-02', requirement: 'R-006' }], meta: { stage: 'closed' } });
    const closed = read('assumptions.md');
    expect(closed).toContain('- Accepted: yes\n- Requirement: R-006');
    expect(read('interview.md')).toContain('stage: closed\nstatus: closed');
  });

  it('meta.accepted flips Accepted to yes without closing the stage', () => {
    log({ meta: { accepted: true } });
    expect(read('assumptions.md')).toContain('- Accepted: yes');
    expect(read('interview.md')).toContain('stage: core\nstatus: open\nareas: hosting, data\nchosenAreas: data\nreclassified: no\naccepted: yes');
    expect(readState(dir).state.meta.accepted).toBe(true);
  });

  it('renders non-goals.md one line per item', () => {
    const md = read('non-goals.md');
    expect(md).toContain('# Non-goals\n\n- N-01 No admin dashboard (read the DB directly) -> -\n- N-02 No payments -> -\n');
    log({ nonGoals: [{ id: 'N-02', requirement: 'R-009' }] });
    expect(read('non-goals.md')).toContain('- N-02 No payments -> R-009');
  });

  it('appends one JSON line per accepted call with at and the ids assigned', () => {
    const lines = read('interview.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ at: NOW, created: { nodes: ['Q-01', 'Q-02', 'Q-03'], nonGoals: ['N-01', 'N-02'], assumptions: ['A-01'] } });
    expect(lines[0].input.nodes.map((n: { id: string }) => n.id)).toEqual(['Q-01', 'Q-02', 'Q-03']);
  });
});

describe('CLI', () => {
  const run = (args: string[], input?: unknown) =>
    runCli(args, { cwd: root, input: input === undefined ? '' : JSON.stringify(input), env: { DRIVER_ROOT: root } });

  it('show on an empty interview says so and exits 0', () => {
    expect(existsSync(CLI)).toBe(true);
    const r = run(['discover', 'show']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no discovery interview yet');
    const j = JSON.parse(run(['discover', 'show', '--json']).stdout);
    expect(j).toMatchObject({ ok: true, exists: false, frontier: [] });
    expect(j.state.nodes).toEqual([]);
    expect(existsSync(f('interview.jsonl'))).toBe(false);
  });

  it('log prints created ids, counts and the frontier; show reads it back', () => {
    const r = run(['discover', 'log'], { meta: { class: 'S' }, nodes: [{ question: 'Who is it for?', kind: 'decision' }, { question: 'Why?', kind: 'fact', status: 'assumed', why: 'obvious' }] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('ok; created Q-01, Q-02; assumptions A-01\nnodes: 2 (open 1, assumed 1); non-goals: 0; stage: core\nfrontier:\n- Q-01 Who is it for?\n');
    const j = JSON.parse(run(['discover', 'show', '--json']).stdout);
    expect(j.exists).toBe(true);
    expect(j.frontier.map((n: { id: string }) => n.id)).toEqual(['Q-01']);
    expect(run(['discover', 'show']).stdout).toContain('Q-02 [assumed A-01] Why?');
  });

  it('a refusal exits 1 with the message and writes nothing', () => {
    const r = run(['discover', 'log'], { nodes: [{ id: 'Q-01', status: 'assumed' }] });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown id Q-01');
    expect(existsSync(f('interview.jsonl'))).toBe(false);
    expect(run(['discover', 'log']).status).toBe(2);
  });

  it('needs an initialized plan', () => {
    const empty = tmp();
    const r = runCli(['discover', 'show', '--root', empty], { cwd: empty });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no plan');
  });
});

describe('review fixes', () => {
  it('assumptions.md lists only nodes assumed now and keeps A-nn when a node re-enters assumed', () => {
    log({ nodes: [{ question: 'a', kind: 'decision', status: 'assumed', why: 'w' }] });
    expect(read('assumptions.md')).toContain('## A-01');
    log({ nodes: [{ id: 'Q-01', status: 'settled', answer: 'user chose' }] });
    expect(read('assumptions.md')).not.toContain('A-01');
    log({ nodes: [{ id: 'Q-01', status: 'assumed' }] });
    expect(read('assumptions.md')).toContain('## A-01');
  });

  it('one-line values cannot forge another frontmatter key or break the table', () => {
    log({ meta: { domain: 'web\rclass: L', goal: 'g\u2028h', batchApplied: 'x\u0085y' }, nodes: [{ question: 'a\\|b\nc', kind: 'fact', answer: 'x\u2029y' }] });
    const md = read('interview.md');
    expect(md).toContain('domain: web class: L\n');
    expect(md.match(/^class: /gm)).toHaveLength(1);
    expect(md).toContain('Goal: g h');
    expect(md).toContain('batch-applied: x y');
    expect(md).toContain('| Q-01 | a\\\\\\|b c |');
    const r = log({ nodes: [{ question: 'next\r\nline', kind: 'fact' }] });
    expect(r.text).toContain('- Q-02 next line');
  });

  it('ignores a truncated last line, rewrites the file without it and says so', () => {
    log({ nodes: [{ question: 'a', kind: 'fact' }] });
    const file = f('interview.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"at":"2026-11-10T12:00:00Z","inp`);
    expect(readState(dir).state.nodes).toHaveLength(1);
    const r = log({ nodes: [{ question: 'b', kind: 'fact' }] });
    expect(r.text).toContain('warning: dropped a truncated last line');
    const lines = readFileSync(file, 'utf8').split('\n');
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe('');
    lines.slice(0, 2).forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
    expect(readState(dir).state.nodes.map((n) => n.id)).toEqual(['Q-01', 'Q-02']);
  });

  it('a complete last line without newline is kept; corruption in the middle names the line', () => {
    log({ nodes: [{ question: 'a', kind: 'fact' }] });
    const file = f('interview.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').trimEnd());
    log({ nodes: [{ question: 'b', kind: 'fact' }] });
    expect(readState(dir).state.nodes).toHaveLength(2);
    const lines = readFileSync(file, 'utf8').split('\n');
    writeFileSync(file, `${lines[0]}\nnot json\n${lines[1]}\n`);
    expect(() => readState(dir)).toThrow(/interview\.jsonl:2:/);
    expect(() => log({ nodes: [{ question: 'c', kind: 'fact' }] })).toThrow(/interview\.jsonl:2:/);
  });
});
