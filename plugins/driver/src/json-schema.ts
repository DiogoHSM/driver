import { z } from 'zod';
import { PlanV1Schema } from './schema.js';

export function buildJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PlanV1Schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}
