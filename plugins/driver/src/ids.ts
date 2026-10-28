import type { PlanV1 } from './schema.js';

export type IdKind = 'R' | 'B' | 'D' | 'REL';

export function formatId(kind: IdKind, n: number): string {
  return kind === 'REL' ? `REL-${n}` : `${kind}-${String(n).padStart(3, '0')}`;
}

export function nextId(plan: PlanV1, kind: IdKind): { id: string; plan: PlanV1 } {
  const n = plan.nextId[kind];
  return { id: formatId(kind, n), plan: { ...plan, nextId: { ...plan.nextId, [kind]: n + 1 } } };
}
