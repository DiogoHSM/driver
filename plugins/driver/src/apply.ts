import { z } from 'zod';
import type { Op } from './reducer.js';
import { PhaseId, BlockStatus, ProviderSchema, TestRefSchema, VerificationSchema } from './schema.js';

const str = z.string();
const strs = z.array(z.string());

const Patch = z.strictObject({
  title: str.optional(),
  dependsOn: strs.optional(),
  requirements: strs.optional(),
  provider: ProviderSchema.optional(),
  artifacts: strs.optional(),
  addArtifacts: strs.optional(),
  tests: z.array(TestRefSchema).optional(),
  addTests: z.array(TestRefSchema).optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  verification: VerificationSchema.optional(),
});

/**
 * Ops accepted by `driver apply`. Deliberately a subset of the reducer: no gate.approve,
 * rebaseline, force, release.add, renumber, orphan, owner.
 */
export const ApplyOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('block.add'),
    title: str.min(1),
    phase: PhaseId,
    dependsOn: strs.optional(),
    requirements: strs.optional(),
    provider: ProviderSchema.optional(),
    risk: z.enum(['low', 'medium', 'high']).optional(),
  }),
  z.strictObject({ op: z.literal('block.set'), id: str, patch: Patch }),
  z.strictObject({ op: z.literal('block.status'), id: str, to: BlockStatus, reason: str.optional(), owner: str.optional() }),
  z.strictObject({
    op: z.literal('req.add'),
    title: str.min(1),
    kind: z.enum(['functional', 'nonfunctional', 'constraint', 'non-goal']),
    source: z.enum(['user', 'assumed']),
    ref: str.optional(),
  }),
  z.strictObject({ op: z.literal('decision.add'), title: str.min(1), reason: str.optional() }),
  z.strictObject({ op: z.literal('block.retire'), id: str, decision: str, reason: str }),
  z.strictObject({ op: z.literal('req.retire'), id: str, decision: str, reason: str }),
  z.strictObject({ op: z.literal('phase.advance') }),
  z.strictObject({ op: z.literal('phase.back'), to: PhaseId, reason: str }),
]);

export const ApplyBodySchema = z.object({
  ops: z.array(z.unknown()).min(1).max(100),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export interface ParsedApply {
  ops: Op[];
  expectedRevision?: number;
}

export class ApplyInputError extends Error {
  constructor(
    message: string,
    readonly failedOp?: number,
  ) {
    super(message);
    this.name = 'ApplyInputError';
  }
}

/** Parses the stdin body; throws ApplyInputError (with the op index when it is one op's fault). */
export function parseApplyBody(text: string): ParsedApply {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ApplyInputError(`stdin is not valid JSON: ${(e as Error).message}`);
  }
  const body = ApplyBodySchema.safeParse(raw);
  if (!body.success) throw new ApplyInputError(`invalid body: ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const ops = body.data.ops.map((o, index): Op => {
    const r = ApplyOpSchema.safeParse(o);
    if (!r.success) {
      const name = typeof (o as { op?: unknown } | null)?.op === 'string' ? (o as { op: string }).op : '(missing)';
      throw new ApplyInputError(
        `op ${name} is not allowed or malformed: ${r.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; ')}`,
        index,
      );
    }
    return toReducerOp(r.data);
  });
  return { ops, ...(body.data.expectedRevision !== undefined ? { expectedRevision: body.data.expectedRevision } : {}) };
}

function toReducerOp(o: z.infer<typeof ApplyOpSchema>): Op {
  switch (o.op) {
    case 'block.add': {
      const { op: _op, ...rest } = o;
      return { type: 'block.add', ...rest };
    }
    case 'block.set':
      return { type: 'block.set', id: o.id, patch: o.patch as Extract<Op, { type: 'block.set' }>['patch'] };
    case 'block.status': {
      const { op: _op, ...rest } = o;
      return { type: 'block.status', ...rest };
    }
    case 'req.add': {
      const { op: _op, ...rest } = o;
      return { type: 'req.add', ...rest };
    }
    case 'decision.add': {
      const { op: _op, ...rest } = o;
      return { type: 'decision.add', ...rest };
    }
    case 'block.retire':
      return { type: 'block.retire', id: o.id, decision: o.decision, reason: o.reason };
    case 'req.retire':
      return { type: 'req.retire', id: o.id, decision: o.decision, reason: o.reason };
    case 'phase.advance':
      return { type: 'phase.advance' };
    case 'phase.back':
      return { type: 'phase.back', to: o.to, reason: o.reason };
  }
}
