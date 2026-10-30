import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Every `from '...'` and side-effect `import '...'` specifier of a source file. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

describe('the mod only depends on itself, src/shared and the engine', () => {
  const modFiles = files(path.join(ROOT, 'mod'));

  it('finds the mod sources', () => {
    expect(modFiles.length).toBeGreaterThan(8);
  });

  for (const file of modFiles) {
    const rel = path.relative(ROOT, file);
    it(`${rel} imports nothing outside mod/, src/shared/, types/ and claude-code`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src, 'dynamic import() does not load in a mod').not.toMatch(/\bimport\s*\(/);
      for (const spec of specifiers(src)) {
        if (spec === 'claude-code' || spec === 'claude-code/testing') continue;
        expect(spec.startsWith('.'), `${spec} must be relative or the engine module`).toBe(true);
        const target = path.resolve(path.dirname(file), spec);
        const inMod = target.startsWith(`${path.join(ROOT, 'mod')}${path.sep}`);
        const inShared = target.startsWith(`${path.join(ROOT, 'src', 'shared')}${path.sep}`);
        const isTypes = target === path.join(ROOT, 'types') || target.startsWith(`${path.join(ROOT, 'types')}${path.sep}`);
        expect(inMod || inShared || isTypes, `${spec} reaches outside mod/ and src/shared/`).toBe(true);
      }
    });
  }

  it('src/shared stays dependency-free (no node: or package imports)', () => {
    for (const file of files(path.join(ROOT, 'src', 'shared'))) {
      for (const spec of specifiers(readFileSync(file, 'utf8')))
        expect(spec.startsWith('./'), `${path.relative(ROOT, file)} imports ${spec}`).toBe(true);
    }
  });

  it('the mod never names the approval entry points from a tool handler', () => {
    // approveViaMod is reachable from the pane (ui.press) and /driver (composer origin) only
    const users = modFiles
      .filter((f) => !f.includes(`${path.sep}test${path.sep}`))
      .filter((f) => /approveViaMod\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
      .sort();
    expect(users).toEqual(['approve.ts', 'command.ts', 'pane.tsx']);
  });
});
