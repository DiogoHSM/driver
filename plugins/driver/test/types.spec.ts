import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PlanV1 } from '../src/schema.js';
import type { PlanDoc } from '../src/shared/plan-doc.js';
import { PKG_ROOT } from './helpers.js';

describe('shared contracts', () => {
  it('PlanV1 is assignable to the hand-written PlanDoc', () => {
    expectTypeOf<PlanV1>().toMatchTypeOf<PlanDoc>();
  });

  it('src/shared stays dependency-free: only relative imports, no node:*', () => {
    const dir = path.join(PKG_ROOT, 'src', 'shared');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        expect(spec.startsWith('./'), `${f} imports ${spec}`).toBe(true);
      }
      expect(src, f).not.toMatch(/\bprocess\.|\bBuffer\b|\bdocument\.|\bwindow\./);
    }
  });
});
