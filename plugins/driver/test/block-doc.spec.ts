import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { blockDocTemplate } from '../src/store.js';
import { runCli, tmp, clonePlan, writePlanFile } from './helpers.js';

let root: string;
let dir: string;
const doc = (id: string): string => readFileSync(path.join(dir, 'blocks', `${id}.md`), 'utf8');
const planBytes = (): string => readFileSync(path.join(dir, 'plan.json'), 'utf8');
const run = (input: unknown, ...extra: string[]) =>
  runCli(['block', 'doc', ...extra], { cwd: root, input: typeof input === 'string' ? input : JSON.stringify(input), env: { DRIVER_ROOT: root } });
const status = (id: string, to: string) => runCli(['block', 'status', id, to], { cwd: root, env: { DRIVER_ROOT: root } });

beforeEach(() => {
  root = tmp();
  dir = path.join(root, '.claude', 'driver');
  const plan = clonePlan('mid-implement') as any;
  plan.blocks['B-007'].retired = { at: '2026-10-28T10:00:00Z', decision: 'D-001', reason: 'dropped' };
  writePlanFile(root, plan);
  mkdirSync(path.join(dir, 'blocks'), { recursive: true });
  writeFileSync(path.join(dir, 'blocks', 'B-004.md'), blockDocTemplate('B-004', 'Confirmation email'));
});

describe('block doc', () => {
  it('rewrites only the named sections and keeps frontmatter, heading and the rest', () => {
    writeFileSync(
      path.join(dir, 'blocks', 'B-004.md'),
      '---\nid: B-004\ntitle: "Confirmation email"\n---\n\n# B-004 Confirmation email\n\n## Spec\n\nold spec\n\n## Acceptance criteria\n\n- [ ] old\n\n## Notes\n\nkeep me\n\n## Handoff\n',
    );
    const r = run({ blocks: [{ id: 'B-004', spec: 'New spec\nsecond line', acceptance: ['Sends mail', '- [x] Logs it', '- [ ] Retries'] }] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('B-004: spec, acceptance (3)\n');
    expect(doc('B-004')).toBe(
      '---\nid: B-004\ntitle: "Confirmation email"\n---\n\n# B-004 Confirmation email\n\n## Spec\n\nNew spec\nsecond line\n\n## Acceptance criteria\n\n- [ ] Sends mail\n- [x] Logs it\n- [ ] Retries\n\n## Notes\n\nkeep me\n\n## Handoff\n',
    );
  });

  it('adds a missing section in canonical order and keeps unknown sections', () => {
    writeFileSync(path.join(dir, 'blocks', 'B-004.md'), '---\nid: B-004\ntitle: "x"\n---\n\n# B-004 x\n\n## Spec\n\ns\n\n## Handoff\n\nh\n\n## Extra\n\ne\n');
    run({ blocks: [{ id: 'B-004', notes: 'n', acceptance: ['a'] }] });
    const text = doc('B-004');
    const at = (h: string): number => text.indexOf(`## ${h}`);
    expect(at('Spec')).toBeLessThan(at('Acceptance criteria'));
    expect(at('Acceptance criteria')).toBeLessThan(at('Notes'));
    expect(at('Notes')).toBeLessThan(at('Handoff'));
    expect(at('Handoff')).toBeLessThan(at('Extra'));
    expect(text).toContain('## Handoff\n\nh\n\n## Extra\n\ne\n');
    expect(text).toContain('## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nn\n\n## Handoff');
  });

  it('creates a missing document with the store template', () => {
    expect(existsSync(path.join(dir, 'blocks', 'B-005.md'))).toBe(false);
    const r = run({ blocks: [{ id: 'B-005', spec: 'S' }] }, '--json');
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, blocks: [{ id: 'B-005', sections: ['spec'], created: true }] });
    expect(doc('B-005')).toBe(blockDocTemplate('B-005', 'End to end signup test').replace('## Spec\n', '## Spec\n\nS\n'));
  });

  it('refuses unknown, retired and done blocks, unknown keys and bad input; all or nothing', () => {
    const before = doc('B-004');
    const plan = planBytes();
    for (const [blocks, msg] of [
      [[{ id: 'B-099', spec: 'x' }], /unknown block B-099/],
      [[{ id: 'B-007', spec: 'x' }], /retired/],
      [[{ id: 'B-001', handoff: 'x' }], /is done/],
      [[{ id: 'B-004', colour: 'x' }], /colour/],
      [[{ id: 'B-004' }], /nothing to write/],
      [[{ id: 'B-004', spec: 'x' }, { id: 'B-004', notes: 'y' }], /listed twice/],
    ] as const) {
      const r = run({ blocks });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(msg);
    }
    const mixed = run({ blocks: [{ id: 'B-004', spec: 'would be written' }, { id: 'B-001', spec: 'refused' }] });
    expect(mixed.status).toBe(1);
    expect(doc('B-004')).toBe(before);
    expect(existsSync(path.join(dir, 'blocks', 'B-001.md'))).toBe(false);
    expect(run({ blocks: [] }).status).toBe(1);
    expect(run('not json').status).toBe(2);
    expect(planBytes()).toBe(plan);
  });

  it('leaves plan.json and the ledger alone', () => {
    const plan = planBytes();
    run({ blocks: [{ id: 'B-004', notes: 'n' }] });
    expect(planBytes()).toBe(plan);
    expect(existsSync(path.join(dir, 'events.jsonl'))).toBe(false);
  });

  it('a handoff written by the command satisfies the in_review check', () => {
    expect(status('B-004', 'in_progress').status).toBe(0);
    expect(runCli(['block', 'set', 'B-004', '--add-artifact', 'src/confirm.ts'], { cwd: root, env: { DRIVER_ROOT: root } }).status).toBe(0);
    const refused = status('B-004', 'in_review');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Handoff');
    expect(run({ blocks: [{ id: 'B-004', handoff: 'Done: endpoint at /api/confirm.\nTests: unit.' }] }).status).toBe(0);
    expect(status('B-004', 'in_review').status).toBe(0);
  });
});

describe('section boundaries', () => {
  it('refuses text that forges or splits a section', () => {
    const before = doc('B-004');
    for (const [e, msg] of [
      [{ spec: 'Intro\n## Handoff\nforged handoff' }, /use ### or plain text/],
      [{ handoff: '## Spec' }, /use ### or plain text/],
      [{ notes: '# Title' }, /use ### or plain text/],
      [{ notes: '```sh\nunclosed' }, /unclosed code fence/],
    ] as const) {
      const r = run({ blocks: [{ id: 'B-004', ...e }] });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(msg);
    }
    expect(doc('B-004')).toBe(before);
  });

  it('allows # lines inside a fence and replaces such a section cleanly', () => {
    expect(run({ blocks: [{ id: 'B-004', spec: 'Run:\n```bash\n# build\nmake\n```' }] }).status).toBe(0);
    expect(doc('B-004')).toContain('# build\nmake');
    expect(run({ blocks: [{ id: 'B-004', spec: 'plain' }] }).status).toBe(0);
    const text = doc('B-004');
    expect(text).not.toContain('# build');
    expect(text).not.toContain('```');
    expect(text).toContain('## Spec\n\nplain\n\n## Acceptance criteria');
  });

  it('a fenced ## heading does not end a section for the handoff check', () => {
    writeFileSync(path.join(dir, 'blocks', 'B-004.md'), '# B-004 x\n\n## Handoff\n\n```md\n## Notes\n```\n');
    expect(doc('B-004')).toContain('## Notes');
    expect(status('B-004', 'in_progress').status).toBe(0);
    runCli(['block', 'set', 'B-004', '--add-artifact', 'a.ts'], { cwd: root, env: { DRIVER_ROOT: root } });
    expect(status('B-004', 'in_review').status).toBe(0);
  });

  it('refuses a duplicate ## Handoff heading, in the check and in block doc', () => {
    writeFileSync(path.join(dir, 'blocks', 'B-004.md'), '# B-004 x\n\n## Spec\n\n## Handoff\n\n## Handoff\n\nreal\n');
    expect(status('B-004', 'in_progress').status).toBe(0);
    runCli(['block', 'set', 'B-004', '--add-artifact', 'a.ts'], { cwd: root, env: { DRIVER_ROOT: root } });
    const r = status('B-004', 'in_review');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('duplicate ## Handoff heading');
    const d = run({ blocks: [{ id: 'B-004', handoff: 'x' }] });
    expect(d.status).toBe(1);
    expect(d.stderr).toContain('duplicate ## Handoff heading');
  });

  it('refuses to rewrite a handoff in_review and empty acceptance entries', () => {
    const r = run({ blocks: [{ id: 'B-003', handoff: 'changed' }] });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('in_review');
    expect(run({ blocks: [{ id: 'B-003', notes: 'ok while in review' }] }).status).toBe(0);
    const e = run({ blocks: [{ id: 'B-004', acceptance: ['fine', '   '] }] });
    expect(e.status).toBe(1);
    expect(e.stderr).toContain('cannot be empty');
  });
});
