import { PHASES, type PlanV1 } from './schema.js';
import { STATUS_COLORS } from './shared/palette.js';

const STATUS_STYLE = Object.entries(STATUS_COLORS).map(
  ([status, c]) => [status, `fill:${c.fill},stroke:${c.stroke},color:${c.text}`] as const,
);

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

  for (const [status, style] of STATUS_STYLE) lines.push(`  classDef ${status} ${style}`);
  for (const [status] of STATUS_STYLE) {
    const members = ids.filter((id) => plan.blocks[id]!.status === status);
    if (members.length > 0) lines.push(`  class ${members.join(',')} ${status}`);
  }
  return `${lines.join('\n')}\n`;
}
