import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJsonSchema } from '../src/json-schema.js';

const out = fileURLToPath(new URL('../schema/plan.v1.schema.json', import.meta.url));
writeFileSync(out, JSON.stringify(buildJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out}`);
