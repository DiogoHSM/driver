import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BacklogRefusedError, addBacklog, readBacklog, renderBacklog } from '../src/backlog.js';
import { initDriverDir } from '../src/store.js';
import { tmp } from './helpers.js';

const NOW = '2026-11-11T10:00:00Z';
let dir: string;
const f = (name: string): string => path.join(dir, name);
const read = (name: string): string => readFileSync(f(name), 'utf8');
const add = (items: unknown, now = NOW) => addBacklog(dir, { items }, now);

beforeEach(() => {
  dir = path.join(tmp(), '.claude', 'driver');
  initDriverDir(dir, 'demo', [], NOW);
});

describe('add', () => {
  it('assigns L-nn in creation order and keeps counting across calls', () => {
    const r = add([{ title: 'Dark mode' }, { title: 'Export CSV', origin: 'B-012', decision: 'D-004', detail: 'asked in validate' }]);
    expect(r.created).toEqual(['L-01', 'L-02']);
    expect(add([{ title: 'Third' }]).created).toEqual(['L-03']);
    const lines = read('backlog.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { id: 'L-01', title: 'Dark mode', at: NOW },
      { id: 'L-02', title: 'Export CSV', detail: 'asked in validate', origin: 'B-012', decision: 'D-004', at: NOW },
      { id: 'L-03', title: 'Third', at: NOW },
    ]);
  });

  it('grows to three digits past 99', () => {
    add(Array.from({ length: 20 }, (_, i) => ({ title: `a${i}` })));
    for (let i = 0; i < 4; i++) add(Array.from({ length: 20 }, (_, j) => ({ title: `b${i}-${j}` })));
    expect(add([{ title: 'x' }, { title: 'y' }]).created).toEqual(['L-101', 'L-102']);
  });

  it('regenerates backlog.md with every entry and the do-not-edit header', () => {
    add([{ title: 'Dark mode', origin: 'user' }]);
    add([{ title: 'Export\nCSV', detail: 'line one\nline two', decision: 'D-002' }]);
    const md = read('backlog.md');
    expect(md).toContain('Do not edit by hand');
    expect(md).toContain('## L-01 Dark mode');
    expect(md).toContain('- Origin: user');
    expect(md).toContain('## L-02 Export CSV');
    expect(md).toContain('- Decision: D-002');
    expect(md).toContain('line one line two');
    expect(md).toBe(renderBacklog(readBacklog(dir).entries));
  });

  it('never touches plan.json, events.jsonl or the revision', () => {
    const before = [read('plan.json'), read('events.jsonl')];
    add([{ title: 'later' }]);
    expect([read('plan.json'), read('events.jsonl')]).toEqual(before);
  });

  it('needs an initialized plan', () => {
    expect(() => addBacklog(path.join(tmp(), '.claude', 'driver'), { items: [{ title: 'x' }] }, NOW)).toThrow(/no plan/);
  });
});

describe('strict validation', () => {
  it.each([
    ['no items', {}],
    ['empty list', { items: [] }],
    ['not a list', { items: 'x' }],
    ['more than 20', { items: Array.from({ length: 21 }, () => ({ title: 't' })) }],
    ['missing title', { items: [{ detail: 'd' }] }],
    ['blank title', { items: [{ title: '   ' }] }],
    ['blank detail', { items: [{ title: 't', detail: '' }] }],
    ['unknown field', { items: [{ title: 't', priority: 'high' }] }],
    ['unknown top-level field', { items: [{ title: 't' }], extra: true }],
    ['bad decision id', { items: [{ title: 't', decision: 'D-1' }] }],
    ['non-string title', { items: [{ title: 5 }] }],
    ['not an object', 'x'],
    ['null', null],
  ])('refuses %s and writes nothing', (_name, raw) => {
    expect(() => addBacklog(dir, raw, NOW)).toThrow(BacklogRefusedError);
    expect(existsSync(f('backlog.jsonl'))).toBe(false);
    expect(existsSync(f('backlog.md'))).toBe(false);
  });

  it('a refusal in a later call leaves the earlier entries as they were', () => {
    add([{ title: 'ok' }]);
    const before = [read('backlog.jsonl'), read('backlog.md')];
    expect(() => add([{ title: 'fine' }, { title: '' }])).toThrow(/items\.1\.title/);
    expect([read('backlog.jsonl'), read('backlog.md')]).toEqual(before);
  });

  it('accepts exactly 20 items', () => {
    expect(add(Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` }))).created).toHaveLength(20);
  });
});

describe('torn log', () => {
  it('drops a truncated last line, rewrites the file without it and says so', () => {
    add([{ title: 'a' }]);
    appendFileSync(f('backlog.jsonl'), '{"id":"L-02","ti');
    const r = add([{ title: 'b' }]);
    expect(r.warnings).toEqual(['dropped a truncated last line of backlog.jsonl']);
    expect(r.created).toEqual(['L-02']);
    expect(read('backlog.jsonl').trim().split('\n').map((l) => JSON.parse(l).id)).toEqual(['L-01', 'L-02']);
  });

  it('keeps a complete last line whose newline is missing', () => {
    add([{ title: 'a' }]);
    appendFileSync(f('backlog.jsonl'), JSON.stringify({ id: 'L-02', title: 'b', at: NOW }));
    const r = add([{ title: 'c' }]);
    expect(r.warnings).toEqual([]);
    expect(r.created).toEqual(['L-03']);
    expect(readBacklog(dir).entries.map((e) => e.id)).toEqual(['L-01', 'L-02', 'L-03']);
  });

  it('reads an empty directory as no backlog', () => {
    expect(readBacklog(dir)).toMatchObject({ entries: [], exists: false });
  });
});
