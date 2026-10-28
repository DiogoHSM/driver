import { PHASES, type BlockStatus, type PlanV1 } from './schema.js';

const STATUS_STYLE: Record<BlockStatus, string> = {
  not_started: 'fill:#e5e7eb,stroke:#6b7280,color:#111827',
  in_progress: 'fill:#bfdbfe,stroke:#2563eb,color:#111827',
  blocked: 'fill:#fecaca,stroke:#dc2626,color:#111827',
  in_review: 'fill:#fef08a,stroke:#ca8a04,color:#111827',
  done: 'fill:#bbf7d0,stroke:#16a34a,color:#111827',
  needs_rework: 'fill:#fed7aa,stroke:#ea580c,color:#111827',
};

const ENTITIES: Record<string, string> = {
  '#': '#35;',
  '"': '#quot;',
  '`': '#96;',
  '<': '#lt;',
  '>': '#gt;',
  '[': '#91;',
  ']': '#93;',
};
const escapeLabel = (s: string): string =>
  s.replace(/\s+/g, ' ').trim().replace(/["#`<>[\]]/g, (c) => ENTITIES[c]!);
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function toMermaid(plan: PlanV1): string {
  const ids = Object.keys(plan.blocks)
    .filter((id) => !plan.blocks[id]!.retired)
    .sort();
  const active = new Set(ids);
  const lines = ['flowchart LR'];

  for (const phase of PHASES) {
    const inPhase = ids.filter((id) => plan.blocks[id]!.phase === phase);
    if (inPhase.length === 0) continue;
    lines.push(`  subgraph ${phase}["${capitalize(phase)}"]`);
    for (const id of inPhase) lines.push(`    ${id}["${id} ${escapeLabel(plan.blocks[id]!.title)}"]`);
    lines.push('  end');
  }

  for (const id of ids)
    for (const dep of plan.blocks[id]!.dependsOn) if (active.has(dep)) lines.push(`  ${dep} --> ${id}`);

  for (const [status, style] of Object.entries(STATUS_STYLE)) lines.push(`  classDef ${status} ${style}`);
  for (const status of Object.keys(STATUS_STYLE)) {
    const members = ids.filter((id) => plan.blocks[id]!.status === status);
    if (members.length > 0) lines.push(`  class ${members.join(',')} ${status}`);
  }
  return `${lines.join('\n')}\n`;
}
