import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clonePlan, runCli, tmp, writePlanFile } from './helpers.js';

let root: string;
let dir: string;
const file = (id: string): string => path.join(dir, 'requirements', `${id}.md`);
const doc = (id: string): string => readFileSync(file(id), 'utf8');
const run = (input: unknown, ...extra: string[]) =>
  runCli(['req', 'doc', ...extra], { cwd: root, input: typeof input === 'string' ? input : JSON.stringify(input), env: { DRIVER_ROOT: root } });

beforeEach(() => {
  root = tmp();
  dir = path.join(root, '.claude', 'driver');
  const plan = clonePlan('mid-implement') as any;
  const [first, second] = Object.keys(plan.requirements);
  plan.requirements[second!].retired = { at: '2026-10-28T10:00:00Z', decision: 'D-001', reason: 'dropped' };
  writePlanFile(root, plan);
  expect(first).toBeDefined();
});

describe('req doc', () => {
  it('creates a missing document with frontmatter from the plan and the heading', () => {
    const plan = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    const r = run({ requirements: [{ id: 'R-001', statement: 'Visitors join.', acceptance: '- Shows a message' }] }, '--json');
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, requirements: [{ id: 'R-001', sections: ['statement', 'acceptance'], created: true }] });
    const q = plan.requirements['R-001'];
    expect(doc('R-001')).toBe(
      `---\nid: R-001\ntitle: ${JSON.stringify(q.title)}\nkind: ${q.kind}\nsource: ${q.source}\n---\n\n# R-001 ${q.title}\n\n## Statement\n\nVisitors join.\n\n## Acceptance signal\n\n- Shows a message\n`,
    );
  });

  it('keeps other sections and extra frontmatter keys, fixes the four keys, inserts in order', () => {
    mkdirSync(path.dirname(file('R-001')), { recursive: true });
    writeFileSync(file('R-001'), '---\nid: R-001\ntitle: stale\nextra: keep\n---\n\n# R-001 stale\n\n## Origin\n\nQ-05\n\n## Notes\n\nn\n');
    expect(run({ requirements: [{ id: 'R-001', statement: 'S', acceptance: 'A' }] }).status).toBe(0);
    const text = doc('R-001');
    expect(text.startsWith('---\nid: R-001\ntitle: "')).toBe(true);
    expect(text).toMatch(/\nextra: keep\n/);
    expect(text).toMatch(/\nkind: functional\n/);
    expect(text).toMatch(/\nsource: user\n---\n/);
    const at = (h: string): number => text.indexOf(`## ${h}`);
    expect(at('Statement')).toBeLessThan(at('Acceptance signal'));
    expect(at('Acceptance signal')).toBeLessThan(at('Origin'));
    expect(at('Origin')).toBeLessThan(at('Notes'));
    expect(text).toContain('## Origin\n\nQ-05\n\n## Notes\n\nn\n');
  });

  it('refuses unknown, retired, duplicate, empty and forged entries; all or nothing', () => {
    const [, second] = Object.keys(JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8')).requirements);
    for (const [requirements, msg] of [
      [[{ id: 'R-099', statement: 'x' }], /unknown requirement/],
      [[{ id: second, statement: 'x' }], /retired/],
      [[{ id: 'R-001', statement: 'x' }, { id: 'R-001', notes: 'y' }], /listed twice/],
      [[{ id: 'R-001' }], /nothing to write/],
      [[{ id: 'R-001', notes: 'a\n## Origin\nforged' }], /use ### or plain text/],
      [[{ id: 'R-001', colour: 'x' }], /colour/],
    ] as const) {
      const r = run({ requirements });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(msg);
    }
    expect(run({ requirements: [{ id: 'R-001', statement: 'would write' }, { id: 'R-099', statement: 'refused' }] }).status).toBe(1);
    expect(existsSync(file('R-001'))).toBe(false);
    expect(run('nope').status).toBe(2);
  });

  it('does not touch plan.json or the ledger', () => {
    const plan = readFileSync(path.join(dir, 'plan.json'), 'utf8');
    run({ requirements: [{ id: 'R-001', notes: 'n' }] });
    expect(readFileSync(path.join(dir, 'plan.json'), 'utf8')).toBe(plan);
    expect(existsSync(path.join(dir, 'events.jsonl'))).toBe(false);
  });
});
