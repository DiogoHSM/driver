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

/** Validate sent work back: B-004 (implement) needs rework, B-006 (validate) waits on it, B-009 entered after baseline 1. */
export function loopedDoc(): PlanDoc {
  const done = { status: 'done' as const };
  return docPlan(
    {
      'B-003': docBlock({ title: 'Landing page UI', phase: 'implement', ...done }),
      'B-004': docBlock({ title: 'Signup API', phase: 'implement', status: 'needs_rework', statusReason: 'validate/B-006.md: criterion 3 fails', dependsOn: ['B-003'] }),
      'B-006': docBlock({ title: 'E2E signup check', phase: 'validate', status: 'blocked', statusReason: 'waiting on B-004', dependsOn: ['B-004'] }),
      'B-009': docBlock({ title: 'Compact signup form with a title long enough to need cutting', phase: 'implement', dependsOn: ['B-003'] }),
    },
    {
      currentPhase: 'validate',
      baselines: [{ n: 1, added: ['B-003', 'B-004', 'B-006'], reqAdded: [], closedAt: 't' }],
    },
  );
}
