import type { BlockStatus, PhaseId } from './phases.js';

export type GateName = 'route' | 'release';

export interface PlanDocGate {
  approved: boolean;
  approvedAt?: string;
  approvedBy?: string;
  atBaseline?: number;
  approvedVia?: string;
  approvedTicket?: string;
}

export interface PlanDocTest {
  ref: string;
  layer: string;
  result: 'pass' | 'fail' | 'unknown';
}

export interface PlanDocBlock {
  title: string;
  phase: PhaseId;
  status: BlockStatus;
  statusSince: string;
  statusBy: { kind: string; id: string };
  statusReason?: string;
  owner?: string;
  dependsOn: string[];
  requirements: string[];
  artifacts?: string[];
  tests: PlanDocTest[];
  verification?: { passes: boolean };
  risk?: 'low' | 'medium' | 'high';
  retired?: { at: string; decision: string; reason: string };
}

/** Structural view of plan.json with only the fields readers use (compatible with PlanV1). */
export interface PlanDoc {
  schemaVersion: 1;
  project: { name: string };
  revision: number;
  baseline: number;
  currentPhase: PhaseId;
  gates: { route: PlanDocGate; release: PlanDocGate };
  requirements: Record<string, { title: string; retired?: unknown }>;
  blocks: Record<string, PlanDocBlock>;
  decisions?: Record<string, { title: string }>;
  baselines?: { n: number; added: string[]; reqAdded: string[]; closedAt?: string; via?: string; ticket?: string }[];
  releases?: { id: string; version: string }[];
}
