import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from './helpers.js';

const SKILLS_DIR = path.join(PKG_ROOT, 'skills');
const REFERENCES_DIR = path.join(PKG_ROOT, 'references');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Tiny `key: value` frontmatter parser (no YAML dependency). */
function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('missing frontmatter');
  const out: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) throw new Error(`bad frontmatter line: ${line}`);
    let value = line.slice(i + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function registeredTools(): string[] {
  const src = readFileSync(path.join(PKG_ROOT, 'mod', 'tools.ts'), 'utf8');
  return [...src.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]!);
}

function allowedOps(): Set<string> {
  const ops = new Set<string>();
  const tools = readFileSync(path.join(PKG_ROOT, 'mod', 'tools.ts'), 'utf8');
  const list = /const PLAN_OPS = \[([^\]]*)\]/.exec(tools)?.[1] ?? '';
  for (const m of list.matchAll(/'([a-z.]+)'/g)) ops.add(m[1]!);
  const apply = readFileSync(path.join(PKG_ROOT, 'src', 'apply.ts'), 'utf8');
  for (const m of apply.matchAll(/op:\s*z\.literal\('([a-z.]+)'\)/g)) ops.add(m[1]!);
  return ops;
}

const skillDirs = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR).filter((n) => existsSync(path.join(SKILLS_DIR, n, 'SKILL.md')))
  : [];
const guarded = [...walk(SKILLS_DIR), ...walk(REFERENCES_DIR)].filter((p) => p.endsWith('.md'));
const mdFiles = guarded.map((p) => ({ rel: path.relative(PKG_ROOT, p), text: readFileSync(p, 'utf8') }));

describe('skills', () => {
  it('ships discover and route', () => {
    expect(skillDirs).toEqual(expect.arrayContaining(['discover', 'route']));
  });

  it('ships the shared conventions file', () => {
    expect(existsSync(path.join(REFERENCES_DIR, 'driver-conventions.md'))).toBe(true);
  });

  describe.each(skillDirs)('%s', (name) => {
    const file = path.join(SKILLS_DIR, name, 'SKILL.md');
    const text = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);

    it('has valid frontmatter', () => {
      expect(fm.name).toBe(name);
      expect(fm.description?.length ?? 0).toBeGreaterThan(0);
      expect(fm.description!.length).toBeLessThan(1024);
      expect(fm['argument-hint']).toBeDefined();
      expect(fm['user-invocable']).toBe('true');
      expect(fm['disable-model-invocation']).toBe('false');
    });

    it('does not fork context', () => {
      expect(fm.context).toBeUndefined();
      expect(text).not.toMatch(/context:\s*fork/);
    });

    it('opens by reading the shared conventions', () => {
      expect(text).toContain('${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md');
    });

    it('resolves every CLAUDE_SKILL_DIR path', () => {
      const refs = [...text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^\s`)"']+)/g)].map((m) => m[1]!.replace(/[.,;:]+$/, ''));
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(existsSync(path.resolve(SKILLS_DIR, name, r)), `${name}: ${r}`).toBe(true);
    });

    it('names only registered mcp__driver__ tools', () => {
      const registered = registeredTools();
      expect(registered).toEqual(expect.arrayContaining(['plan_ops', 'set_block_state', 'plan_status']));
      const used = [...(text + fm['allowed-tools']).matchAll(/mcp__driver__([a-z_]+)/g)].map((m) => m[1]!);
      expect(used.length).toBeGreaterThan(0);
      for (const u of used) expect(registered, `mcp__driver__${u}`).toContain(u);
    });
  });

  it('only cites ops the plan tools accept', () => {
    const ops = allowedOps();
    expect(ops.has('block.add')).toBe(true);
    const mentioned = mdFiles.flatMap((f) =>
      [...f.text.matchAll(/`((?:block|req|decision|phase|gate)\.[a-z]+)`/g)].map((m) => ({ file: f.rel, op: m[1]! })),
    );
    expect(mentioned.length).toBeGreaterThan(0);
    const warningCodes = new Set(['req.coverage']);
    for (const m of mentioned.filter((x) => !warningCodes.has(x.op))) expect(ops.has(m.op), `${m.file}: ${m.op}`).toBe(true);
  });

  it('has no em dash in skills or references', () => {
    expect(mdFiles.length).toBeGreaterThan(0);
    for (const f of mdFiles) expect(f.text.includes('—'), f.rel).toBe(false);
  });
});
