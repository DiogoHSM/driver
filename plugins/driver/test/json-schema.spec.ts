import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildJsonSchema } from '../src/json-schema.js';

describe('generated JSON Schema', () => {
  it('is in sync with the zod schema (run npm run schema:json)', () => {
    const file = fileURLToPath(new URL('../schema/plan.v1.schema.json', import.meta.url));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildJsonSchema())));
  });
});
