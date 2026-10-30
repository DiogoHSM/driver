export const PHASES = ['discover', 'route', 'implement', 'validate', 'evolve', 'release'] as const;
export type PhaseId = (typeof PHASES)[number];

export const BLOCK_STATUSES = ['not_started', 'in_progress', 'blocked', 'in_review', 'done', 'needs_rework'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export const TEST_LAYERS = ['unit', 'integration', 'e2e', 'visual', 'perf', 'security', 'acceptance', 'manual'] as const;

export function phaseIndex(p: PhaseId): number {
  return PHASES.indexOf(p);
}

export function comparePhase(a: PhaseId, b: PhaseId): number {
  return phaseIndex(a) - phaseIndex(b);
}

export const STATUS_GLYPH: Record<BlockStatus, string> = {
  not_started: '○',
  in_progress: '●',
  blocked: '■',
  in_review: '◐',
  done: '✓',
  needs_rework: '↺',
};

export const STATUS_LABEL: Record<BlockStatus, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  blocked: 'blocked',
  in_review: 'in review',
  done: 'done',
  needs_rework: 'needs rework',
};
