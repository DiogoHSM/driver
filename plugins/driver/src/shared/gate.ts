import type { PlanDoc } from './plan-doc.js';

const MARKER = /DRIVER-BLOCK:\s*(B-\d+)/;

/** The block id named by a `DRIVER-BLOCK: B-nnn` marker in `text`, if any. */
export function blockMarker(text: string | undefined): string | undefined {
  return MARKER.exec(text ?? '')?.[1];
}

export type GateVerdict = { allow: true } | { allow: false; reason: string };

/**
 * Whether an agent may run for the block named in `text` (marker `DRIVER-BLOCK: B-nnn`),
 * falling back to the current phase. Same semantics as hooks/gate-check.sh.
 */
export function gateVerdict(plan: PlanDoc, text: string | undefined): GateVerdict {
  const blockId = blockMarker(text);
  const block = blockId ? plan.blocks?.[blockId] : undefined;
  const phase = block && typeof block === 'object' ? (block.phase ?? null) : (plan.currentPhase ?? null);
  const where = block ? `block ${blockId} (${phase})` : `current phase (${phase})`;

  if (phase !== 'discover' && plan.gates?.route?.approved !== true)
    return {
      allow: false,
      reason: `DRIVER: gate route is not approved; ${where} cannot run agents. Ask the user to run, in their own terminal: driver gate approve route`,
    };
  if (phase === 'release' && plan.gates?.release?.approved !== true)
    return {
      allow: false,
      reason: `DRIVER: gate release is not approved; ${where} cannot run agents. Ask the user to run, in their own terminal: driver gate approve release`,
    };
  return { allow: true };
}
