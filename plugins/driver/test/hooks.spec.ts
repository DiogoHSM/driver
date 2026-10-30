import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateCheck, protectPlan } from '../src/hooks.js';
import { initDriverDir } from '../src/store.js';
import { NOW, loadFixture, tmp, writePlanFile } from './helpers.js';

function project(): { root: string; driver: string } {
  const root = realpathSync(tmp());
  const driver = path.join(root, '.claude', 'driver');
  initDriverDir(driver, 'demo', [], NOW);
  return { root, driver };
}

const write = (cwd: string, file_path: string, tool_name = 'Write') => protectPlan({ tool_name, tool_input: { file_path }, cwd });

describe('protectPlan (node hook)', () => {
  it('denies the plan files, case aliases and normalised paths', () => {
    const { root } = project();
    for (const f of [
      '.claude/driver/plan.json',
      '.Claude/Driver/plan.json',
      '.CLAUDE/DRIVER/events.jsonl',
      '.claude/./driver//plan.json',
      'sub/../.claude/driver/plan.json',
      '.claude/driver/.mod/ticket.json',
      path.join(root, '.Claude', 'Driver', 'PLAN.JSON'),
      path.join(root, '.claude', 'driver', 'log', 'REL-1.jsonl'),
    ])
      for (const tool of ['Write', 'Edit', 'MultiEdit']) expect(write(root, f, tool), `${tool} ${f}`).toMatch(/^DRIVER:/);
  });

  it('allows other files under and around the driver dir', () => {
    const { root } = project();
    for (const f of ['.claude/driver/blocks/B-001.md', '.claude/driver/exports/plan.mmd', 'src/plan.json', '.claude/settings.json'])
      expect(write(root, f), f).toBeNull();
  });

  it('denies a symlinked directory that points at .claude/driver', () => {
    const { root } = project();
    symlinkSync('.claude/driver', path.join(root, 'alias'));
    expect(write(root, path.join(root, 'alias', 'plan.json'))).toMatch(/^DRIVER:/);
    expect(write(root, 'alias/events.jsonl', 'Edit')).toMatch(/^DRIVER:/);
    expect(write(root, 'alias/.mod/ticket.json')).toMatch(/^DRIVER:/);
    expect(write(root, 'alias/blocks/B-001.md')).toBeNull();
  });

  it('denies a symlink to the driver dir that lives in another directory, a symlinked file, and a nested alias', () => {
    const { root, driver } = project();
    const elsewhere = realpathSync(tmp());
    symlinkSync(driver, path.join(elsewhere, 'link'));
    expect(write(root, path.join(elsewhere, 'link', 'plan.json'))).toMatch(/^DRIVER:/);
    symlinkSync(path.join(driver, 'plan.json'), path.join(root, 'plan-alias.json'));
    expect(write(root, 'plan-alias.json')).toMatch(/^DRIVER:/);
    mkdirSync(path.join(root, 'deep'));
    symlinkSync(path.join(root, '.claude'), path.join(root, 'deep', 'c'));
    expect(write(root, 'deep/c/driver/plan.json')).toMatch(/^DRIVER:/);
    expect(write(root, 'deep/c/driver/plan.json.new')).toBeNull();
  });

  it('keeps denying Bash writes and user-only actions, with case insensitivity', () => {
    const { root } = project();
    const bash = (command: string) => protectPlan({ tool_name: 'Bash', tool_input: { command }, cwd: root });
    expect(bash('echo {} > .Claude/Driver/plan.json')).toMatch(/^DRIVER:/);
    expect(bash('driver gate approve route')).toMatch(/^DRIVER:/);
    expect(bash('printf x | node dist/cli.js gate --via-mod approve route')).toMatch(/^DRIVER:/);
    expect(bash('driver status')).toBeNull();
  });

  it('guards nothing where there is no plan', () => {
    const cwd = realpathSync(tmp());
    const bash = (command: string) => protectPlan({ tool_name: 'Bash', tool_input: { command }, cwd });
    expect(bash('socat TCP-LISTEN:8080 TCP:localhost:3000')).toBeNull();
    expect(bash('script -q /dev/null ls')).toBeNull();
    expect(bash('echo {} > .claude/driver/plan.json')).toBeNull();
    expect(write(cwd, '.claude/driver/plan.json')).toBeNull();
  });

  it('ignores missing input and non-file tools', () => {
    expect(protectPlan(undefined)).toBeNull();
    expect(protectPlan({ tool_name: 'Read', tool_input: { file_path: '.claude/driver/plan.json' } })).toBeNull();
    expect(protectPlan({ tool_name: 'Write', tool_input: {} })).toBeNull();
  });
});

describe('gateCheck (node hook, shared gateVerdict)', () => {
  it('denies and allows exactly like the shell hook', () => {
    const d = tmp();
    writePlanFile(d, loadFixture('valid', 'mid-implement'));
    expect(gateCheck({ cwd: d, tool_name: 'Agent', tool_input: { prompt: 'DRIVER-BLOCK: B-001 go' } })).toBeNull();
    const plan = loadFixture('valid', 'mid-implement');
    plan.gates.route.approved = false;
    writePlanFile(d, plan);
    expect(gateCheck({ cwd: d, tool_input: { prompt: 'x' } })).toMatch(/gate route is not approved; current phase \(implement\)/);
    expect(gateCheck({ cwd: d, tool_input: { description: 'DRIVER-BLOCK: B-003' } })).toMatch(/block B-003 \(implement\)/);
    expect(gateCheck({ cwd: d, tool_name: 'SendMessage', tool_input: { to: 'a1', message: 'DRIVER-BLOCK: B-003 continue' } })).toMatch(/block B-003 \(implement\)/);
    writePlanFile(d, '{ nope');
    expect(gateCheck({ cwd: d })).toMatch(/unreadable/);
  });
});
