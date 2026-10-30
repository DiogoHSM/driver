import { z } from 'zod';
import { BLOCK_STATUSES, PHASES, TEST_LAYERS, comparePhase, phaseIndex } from './shared/phases.js';

export const PLAN_SCHEMA_URL = './schema/plan.v1.schema.json';

export { BLOCK_STATUSES, PHASES, TEST_LAYERS, comparePhase, phaseIndex };

export const PhaseId = z.enum(PHASES);
export type PhaseId = z.infer<typeof PhaseId>;

export const BlockStatus = z.enum(BLOCK_STATUSES);
export type BlockStatus = z.infer<typeof BlockStatus>;

export const RequirementIdSchema = z.string().regex(/^R-\d{3,}$/);
export const BlockIdSchema = z.string().regex(/^B-\d{3,}$/);
export const DecisionIdSchema = z.string().regex(/^D-\d{3,}$/);
export const ReleaseIdSchema = z.string().regex(/^REL-\d+$/);

const Timestamp = z.iso.datetime({ offset: true });
const Ext = z.record(z.string(), z.unknown()).optional();

export const ActorSchema = z.looseObject({
  kind: z.enum(['model', 'user', 'hook']),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof ActorSchema>;

export const GateSchema = z.looseObject({
  approved: z.boolean(),
  approvedAt: Timestamp.optional(),
  approvedBy: z.string().optional(),
  atBaseline: z.number().int().nonnegative().optional(),
  approvedVia: z.enum(['tty', 'mod']).optional(),
  approvedTicket: z.string().optional(),
  revokedAt: Timestamp.optional(),
  revokedReason: z.string().optional(),
});
export type Gate = z.infer<typeof GateSchema>;

export const RetirementSchema = z.looseObject({
  at: Timestamp,
  decision: DecisionIdSchema,
  reason: z.string(),
});
export type Retirement = z.infer<typeof RetirementSchema>;

export const RequirementSchema = z.looseObject({
  title: z.string().min(1),
  kind: z.enum(['functional', 'nonfunctional', 'constraint', 'non-goal']),
  source: z.enum(['user', 'assumed']),
  ref: z.string().optional(),
  retired: RetirementSchema.optional(),
  ext: Ext,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const TestRefSchema = z.looseObject({
  ref: z.string().min(1),
  layer: z.enum(TEST_LAYERS),
  result: z.enum(['pass', 'fail', 'unknown']),
  at: Timestamp.optional(),
  commit: z.string().optional(),
});
export type TestRef = z.infer<typeof TestRefSchema>;

export const ProviderSchema = z.looseObject({
  capability: z.string().min(1),
  provider: z.string().min(1),
  access: z.enum(['cli', 'mcp', 'api']),
  credentials: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
});
export type Provider = z.infer<typeof ProviderSchema>;

export const VerificationSchema = z.looseObject({
  passes: z.boolean(),
  at: Timestamp,
  by: ActorSchema,
  commit: z.string().optional(),
});

export const BlockSchema = z.looseObject({
  title: z.string().min(1),
  phase: PhaseId,
  status: BlockStatus,
  statusSince: Timestamp,
  statusBy: ActorSchema,
  statusReason: z.string().optional(),
  owner: z.string().optional(),
  dependsOn: z.array(BlockIdSchema),
  requirements: z.array(RequirementIdSchema),
  provider: ProviderSchema.optional(),
  artifacts: z.array(z.string()),
  tests: z.array(TestRefSchema),
  verification: VerificationSchema.optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  retired: RetirementSchema.optional(),
  ext: Ext,
});
export type Block = z.infer<typeof BlockSchema>;

export const BaselineEntrySchema = z.looseObject({
  n: z.number().int().positive(),
  at: Timestamp,
  decision: DecisionIdSchema,
  reason: z.string(),
  added: z.array(BlockIdSchema),
  retired: z.array(BlockIdSchema),
  changed: z.array(BlockIdSchema),
  reqAdded: z.array(RequirementIdSchema),
  reqRetired: z.array(RequirementIdSchema),
});
export type BaselineEntry = z.infer<typeof BaselineEntrySchema>;

export const ReleaseSchema = z.looseObject({
  id: ReleaseIdSchema,
  version: z.string().min(1),
  at: Timestamp,
  baseline: z.number().int().nonnegative(),
  commit: z.string(),
  blocks: z.array(BlockIdSchema),
});
export type Release = z.infer<typeof ReleaseSchema>;

export const DecisionSchema = z.looseObject({
  title: z.string().min(1),
  at: Timestamp,
  reason: z.string().optional(),
  by: ActorSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

const Counter = z.number().int().positive();

export const PlanV1Schema = z.looseObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  project: z.looseObject({
    name: z.string().min(1),
    packs: z.array(z.string()),
    createdAt: Timestamp,
  }),
  revision: z.number().int().nonnegative(),
  baseline: z.number().int().nonnegative(),
  updatedAt: Timestamp,
  currentPhase: PhaseId,
  nextId: z.looseObject({ R: Counter, B: Counter, D: Counter, REL: Counter }),
  gates: z.looseObject({ route: GateSchema, release: GateSchema }),
  requirements: z.record(RequirementIdSchema, RequirementSchema),
  blocks: z.record(BlockIdSchema, BlockSchema),
  decisions: z.record(DecisionIdSchema, DecisionSchema).optional(),
  baselines: z.array(BaselineEntrySchema),
  releases: z.array(ReleaseSchema),
  ext: Ext,
});
export type PlanV1 = z.infer<typeof PlanV1Schema>;

export function emptyPlan(name: string, packs: string[], now: string): PlanV1 {
  return {
    schemaVersion: 1,
    project: { name, packs, createdAt: now },
    revision: 0,
    baseline: 0,
    updatedAt: now,
    currentPhase: 'discover',
    nextId: { R: 1, B: 1, D: 1, REL: 1 },
    gates: { route: { approved: false }, release: { approved: false } },
    requirements: {},
    blocks: {},
    decisions: {},
    baselines: [],
    releases: [],
  };
}
