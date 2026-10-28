import type { Event } from './reducer.js';
import type { PlanV1 } from './schema.js';
import type { Issue } from './validate.js';

/** Folds block.add / block.status events and compares with the snapshot. */
export function replayIssues(plan: PlanV1, events: Event[]): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ level: 'error', code, path, message });

  events.forEach((e, i) => {
    if (e.seq !== i + 1) add('replay.seq', `events.${i}`, `expected seq ${i + 1}, found ${String(e.seq)}`);
  });

  const folded = new Map<string, string>();
  for (const e of events) {
    if (!e.block) continue;
    if (e.type === 'block.add') folded.set(e.block, 'not_started');
    else if (e.type === 'block.status' && e.to) folded.set(e.block, e.to);
  }
  for (const [id, b] of Object.entries(plan.blocks)) {
    const expected = folded.get(id);
    if (expected === undefined) {
      if (b.status !== 'not_started') add('replay.missing', `blocks.${id}`, `${id} is ${b.status} but has no events`);
    } else if (expected !== b.status) {
      add('replay.mismatch', `blocks.${id}.status`, `ledger says ${expected}, plan.json says ${b.status}`);
    }
  }
  for (const id of folded.keys())
    if (!(id in plan.blocks)) add('replay.unknown', `blocks.${id}`, `ledger mentions ${id}, absent from plan.json`);
  return issues;
}
