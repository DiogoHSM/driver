import { PHASES, type BlockStatus, type PhaseId } from '../src/shared/phases.js';
import type { PlanDoc, PlanDocBlock } from '../src/shared/plan-doc.js';

export function docBlock(over: Partial<PlanDocBlock> & { title: string; phase: PhaseId }): PlanDocBlock {
  return {
    status: 'not_started',
    statusSince: '2026-10-28T10:00:00Z',
    statusBy: { kind: 'model', id: 'main' },
    dependsOn: [],
    requirements: [],
    tests: [],
    ...over,
  };
}

export function docPlan(blocks: Record<string, PlanDocBlock>, over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    schemaVersion: 1,
    project: { name: 'gen' },
    revision: 7,
    baseline: 1,
    currentPhase: 'implement',
    gates: { route: { approved: true, approvedBy: 'diogo', approvedAt: '2026-10-21T10:00:00Z' }, release: { approved: false } },
    requirements: {},
    blocks,
    ...over,
  };
}

const id = (n: number): string => `B-${String(n).padStart(3, '0')}`;
const STATUS_CYCLE: BlockStatus[] = ['done', 'done', 'in_progress', 'not_started', 'blocked', 'in_review', 'needs_rework', 'not_started'];

/** n blocks over the six phases; chains of 4 inside each phase plus a cross-phase dep per chain head. */
export function generatedPlan(n: number, statuses: BlockStatus[] = STATUS_CYCLE): PlanDoc {
  const blocks: Record<string, PlanDocBlock> = {};
  for (let i = 1; i <= n; i++) {
    const phase = PHASES[Math.min(PHASES.length - 1, Math.floor(((i - 1) / n) * PHASES.length))]!;
    const deps: string[] = [];
    if ((i - 1) % 4 !== 0) deps.push(id(i - 1));
    if (i > 4) deps.push(id(i - 4));
    blocks[id(i)] = docBlock({
      title: `Generated block number ${i} with a fairly long title`,
      phase,
      status: statuses[i % statuses.length]!,
      dependsOn: deps,
      ...(i % 5 === 0 ? { owner: `agent-${i}abcdef` } : {}),
      ...(i % 7 === 0 ? { risk: 'high' as const } : {}),
    });
  }
  return docPlan(blocks, { currentPhase: 'implement' });
}
