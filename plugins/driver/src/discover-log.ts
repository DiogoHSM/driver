import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { NotInitializedError, withLock } from './store.js';

/** ADR-013 item 6: the discovery interview as an append-only log, folded into state and rendered to markdown. */

export const CLASSES = ['XS', 'S', 'M', 'L'] as const;
export const STAGES = ['core', 'areas', 'summary', 'closed'] as const;
export const CHECKPOINTS = ['none', 'pre-mortem', 'red-team', 'socratic', 'skipped'] as const;
export const KINDS = ['fact', 'decision'] as const;
export const NODE_STATUSES = ['open', 'researching', 'settled', 'assumed', 'deferred'] as const;
export const SOURCES = ['user', 'research', 'assumed'] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

const nodeId = z.string().regex(/^Q-\d{2,}$/, 'must look like Q-01');
const nonGoalId = z.string().regex(/^N-\d{2,}$/, 'must look like N-01');
const reqId = z.string().regex(/^R-\d+$/, 'must look like R-001');

const MetaInput = z.strictObject({
  goal: z.string().optional(),
  class: z.enum(CLASSES).optional(),
  domain: z.string().optional(),
  language: z.string().optional(),
  stage: z.enum(STAGES).optional(),
  areas: z.array(z.string()).optional(),
  chosenAreas: z.array(z.string()).optional(),
  reclassified: z.boolean().optional(),
  accepted: z.boolean().optional(),
  checkpoint: z.enum(CHECKPOINTS).optional(),
  batchApplied: z.string().optional(),
});

const NodeInput = z.strictObject({
  id: nodeId.optional(),
  question: z.string().optional(),
  area: z.string().optional(),
  dependsOn: z.array(nodeId).optional(),
  kind: z.enum(KINDS).optional(),
  status: z.enum(NODE_STATUSES).optional(),
  answer: z.string().optional(),
  source: z.enum(SOURCES).optional(),
  options: z.array(z.string()).optional(),
  why: z.string().optional(),
  requirement: reqId.optional(),
});

const NonGoalInput = z.strictObject({
  id: nonGoalId.optional(),
  statement: z.string().optional(),
  reason: z.string().optional(),
  requirement: reqId.optional(),
});

export const DiscoverInputSchema = z.strictObject({
  meta: MetaInput.optional(),
  nodes: z.array(NodeInput).optional(),
  nonGoals: z.array(NonGoalInput).optional(),
});

export type DiscoverInput = z.infer<typeof DiscoverInputSchema>;

export interface Meta {
  goal?: string;
  class?: (typeof CLASSES)[number];
  domain?: string;
  language?: string;
  stage: (typeof STAGES)[number];
  areas: string[];
  chosenAreas: string[];
  reclassified: boolean;
  accepted: boolean;
  checkpoint: (typeof CHECKPOINTS)[number];
  batchApplied: string;
}

export interface DiscoverNode {
  id: string;
  question: string;
  area: string;
  dependsOn: string[];
  kind: (typeof KINDS)[number];
  status: NodeStatus;
  answer?: string;
  source?: (typeof SOURCES)[number];
  options: string[];
  why?: string;
  requirement?: string;
  assumption?: string;
  at: string;
}

export interface NonGoal {
  id: string;
  statement: string;
  reason?: string;
  requirement?: string;
}

export interface DiscoverState {
  meta: Meta;
  nodes: DiscoverNode[];
  nonGoals: NonGoal[];
}

export interface Created {
  nodes: string[];
  nonGoals: string[];
  assumptions: string[];
}

interface LogLine {
  at: string;
  input: DiscoverInput;
  created: Created;
}

/** The input was refused; nothing was written. */
export class DiscoverRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoverRefusedError';
  }
}

export const emptyState = (): DiscoverState => ({
  meta: { stage: 'core', areas: [], chosenAreas: [], reclassified: false, accepted: false, checkpoint: 'none', batchApplied: '-' },
  nodes: [],
  nonGoals: [],
});

const refuse = (m: string): never => {
  throw new DiscoverRefusedError(m);
};

function nextId(prefix: string, used: string[]): string {
  let max = 0;
  for (const id of used) max = Math.max(max, Number(id.slice(prefix.length + 1)) || 0);
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

function checkAcyclic(nodes: DiscoverNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) refuse(`dependsOn cycle: ${[...trail, id].join(' -> ')}`);
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOn ?? []) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const n of nodes) visit(n.id, []);
}

const def = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Applies one input to a state. Pure: returns a new state plus the input with every id resolved
 * (what gets logged). `replay` lets an explicit unknown id create the entry (folding the log).
 */
export function applyInput(
  prev: DiscoverState,
  input: DiscoverInput,
  at: string,
  replay = false,
): { state: DiscoverState; resolved: DiscoverInput; created: Created } {
  const state = structuredClone(prev);
  const created: Created = { nodes: [], nonGoals: [], assumptions: [] };
  const resolved: DiscoverInput = {};

  if (input.meta) {
    Object.assign(state.meta, def(input.meta));
    resolved.meta = input.meta;
  }

  if (input.nodes) {
    resolved.nodes = [];
    input.nodes.forEach((n, i) => {
      const where = `nodes[${i}]`;
      let node = n.id ? state.nodes.find((x) => x.id === n.id) : undefined;
      if (n.id && !node && !replay) refuse(`${where}: unknown id ${n.id} (omit id to create a node)`);
      if (!node) {
        if (!n.question?.trim()) refuse(`${where}: creating a node needs a question`);
        if (!n.kind) refuse(`${where}: creating a node needs a kind (fact or decision)`);
        const id = n.id ?? nextId('Q', state.nodes.map((x) => x.id));
        node = { id, question: '', area: 'core', dependsOn: [], kind: n.kind!, status: 'open', options: [], at };
        state.nodes.push(node);
        created.nodes.push(id);
      }
      const { id: _id, ...fields } = def(n);
      Object.assign(node, fields, { at });
      resolved.nodes!.push({ ...n, id: node.id });
      const label = `${where} (${node.id})`;
      for (const d of node.dependsOn) {
        if (d === node.id) refuse(`${label}: a node cannot depend on itself`);
        if (!state.nodes.some((x) => x.id === d)) refuse(`${label}: dependsOn ${d} does not exist`);
      }
      if (node.status === 'assumed') {
        if (!node.why?.trim()) refuse(`${label}: status assumed needs a why`);
        if (!node.assumption) {
          node.assumption = nextId('A', state.nodes.flatMap((x) => (x.assumption ? [x.assumption] : [])));
          created.assumptions.push(node.assumption);
        }
      }
    });
    checkAcyclic(state.nodes);
  }

  if (input.nonGoals) {
    resolved.nonGoals = [];
    input.nonGoals.forEach((g, i) => {
      const where = `nonGoals[${i}]`;
      let item = g.id ? state.nonGoals.find((x) => x.id === g.id) : undefined;
      if (g.id && !item && !replay) refuse(`${where}: unknown id ${g.id} (omit id to create a non-goal)`);
      if (!item) {
        if (!g.statement?.trim()) refuse(`${where}: creating a non-goal needs a statement`);
        const id = g.id ?? nextId('N', state.nonGoals.map((x) => x.id));
        item = { id, statement: '' };
        state.nonGoals.push(item);
        created.nonGoals.push(id);
      }
      const { id: _id, ...fields } = def(g);
      Object.assign(item, fields);
      resolved.nonGoals!.push({ ...g, id: item.id });
    });
  }

  return { state, resolved, created };
}

export const discoverDir = (driverDir: string): string => path.join(driverDir, 'discover');
const logFile = (driverDir: string): string => path.join(discoverDir(driverDir), 'interview.jsonl');

/** Folds interview.jsonl; `exists` is false when there is no log yet. */
export function readState(driverDir: string): { state: DiscoverState; exists: boolean; kept: string[]; repair: boolean; dropped: boolean } {
  const file = logFile(driverDir);
  if (!existsSync(file)) return { state: emptyState(), exists: false, kept: [], repair: false, dropped: false };
  let state = emptyState();
  const lines = readFileSync(file, 'utf8').split('\n');
  // text after the last newline is an unfinished write: a torn (invalid JSON) one is ignored
  const tail = lines[lines.length - 1]!;
  let dropped = false;
  let repair = false;
  if (tail.trim() !== '') {
    try {
      JSON.parse(tail);
      repair = true; // complete line, newline missing
    } catch {
      dropped = true;
      repair = true;
      lines.pop();
    }
  }
  const kept: string[] = [];
  lines.forEach((l, i) => {
    if (l.trim() === '') return;
    kept.push(l);
    let line: LogLine;
    try {
      line = JSON.parse(l) as LogLine;
      state = applyInput(state, DiscoverInputSchema.parse(line.input), line.at, true).state;
    } catch (e) {
      throw new Error(`${file}:${i + 1}: ${(e as Error).message}`);
    }
  });
  return { state, exists: true, kept, repair, dropped };
}

export function frontier(state: DiscoverState): DiscoverNode[] {
  const done = new Set(state.nodes.filter((n) => n.status === 'settled' || n.status === 'assumed').map((n) => n.id));
  return state.nodes.filter((n) => n.status === 'open' && n.dependsOn.every((d) => done.has(d)));
}

export function countsByStatus(state: DiscoverState): Record<NodeStatus, number> {
  const c = Object.fromEntries(NODE_STATUSES.map((s) => [s, 0])) as Record<NodeStatus, number>;
  for (const n of state.nodes) c[n.status]++;
  return c;
}

// ---- rendering ----

const GENERATED = '<!-- Generated from interview.jsonl by `driver discover log`. Do not edit by hand. -->';
/** Any value shown on one line: every run of line breaks (CR, LF, U+2028, U+2029, U+0085) becomes a space. */
export const line1 = (s: string | undefined): string => (s ?? '').replace(/[\r\n\u2028\u2029\u0085]+/g, ' ');
const cell = (s: string | undefined): string => line1(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const listOrDash = (l: string[]): string => (l.length ? l.map(line1).join(', ') : '-');

export function renderInterview(state: DiscoverState): string {
  const m = state.meta;
  const out = [
    '---',
    `class: ${m.class ?? '-'}`,
    `domain: ${line1(m.domain) || '-'}`,
    `language: ${line1(m.language) || '-'}`,
    `stage: ${m.stage}`,
    `status: ${m.stage === 'closed' ? 'closed' : 'open'}`,
    `areas: ${listOrDash(m.areas)}`,
    `chosenAreas: ${listOrDash(m.chosenAreas)}`,
    `reclassified: ${m.reclassified ? 'yes' : 'no'}`,
    `accepted: ${m.accepted ? 'yes' : 'no'}`,
    `checkpoint: ${m.checkpoint}`,
    `batch-applied: ${line1(m.batchApplied) || '-'}`,
    '---',
    GENERATED,
    '',
    '# Discovery interview',
    '',
    `Goal: ${line1(m.goal) || '-'}`,
    '',
    '## Decision tree',
    '',
    '| id | question | area | dependsOn | kind | status | answer | source |',
    '|---|---|---|---|---|---|---|---|',
    ...state.nodes.map(
      (n) =>
        `| ${n.id} | ${cell(n.question)} | ${cell(n.area)} | ${cell(n.dependsOn.length ? n.dependsOn.join(', ') : '-')} | ${n.kind} | ${n.status} | ${cell(n.answer)} | ${n.source ?? ''} |`,
    ),
    '',
    '## Log',
  ];
  for (const n of state.nodes.filter((x) => x.answer?.trim())) {
    out.push('', `**${n.id}** (${line1(n.at)})`, `Question: ${line1(n.question)}`);
    if (n.options.length) out.push(`Options shown: ${n.options.map(line1).join(' / ')}`);
    out.push(`Answer: ${line1(n.answer)}`);
  }
  return `${out.join('\n')}\n`;
}

export function renderAssumptions(state: DiscoverState): string {
  const accepted = state.meta.accepted || state.meta.stage === 'closed' ? 'yes' : 'pending';
  const out = [GENERATED, '', '# Assumptions'];
  const items = state.nodes.filter((n) => n.assumption && n.status === 'assumed').sort((a, b) => a.assumption!.localeCompare(b.assumption!, undefined, { numeric: true }));
  for (const n of items) {
    out.push(
      '',
      `## ${n.assumption} ${line1(n.answer?.trim() ? n.answer : n.question)}`,
      '',
      `- Why assumed: ${line1(n.why)}`,
      `- Source node: ${n.id}`,
      `- Accepted: ${accepted}`,
      `- Requirement: ${n.requirement ?? '-'}`,
    );
  }
  return `${out.join('\n')}\n`;
}

export function renderNonGoals(state: DiscoverState): string {
  const out = [GENERATED, '', '# Non-goals', ''];
  for (const g of state.nonGoals)
    out.push(`- ${g.id} ${line1(g.statement)}${g.reason?.trim() ? ` (${line1(g.reason)})` : ''} -> ${g.requirement ?? '-'}`);
  return `${out.join('\n')}\n`;
}

export function atomicWrite(driverDir: string, file: string, content: string): void {
  const tmpDir = path.join(driverDir, '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${path.basename(file)}.${process.pid}`);
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export function summaryText(state: DiscoverState, created?: Created): string {
  const c = countsByStatus(state);
  const parts = NODE_STATUSES.filter((s) => c[s]).map((s) => `${s} ${c[s]}`);
  const lines: string[] = [];
  if (created) {
    const ids = [...created.nodes, ...created.nonGoals];
    lines.push(`ok${ids.length ? `; created ${ids.join(', ')}` : ''}${created.assumptions.length ? `; assumptions ${created.assumptions.join(', ')}` : ''}`);
  }
  lines.push(`nodes: ${state.nodes.length} (${parts.join(', ') || 'none'}); non-goals: ${state.nonGoals.length}; stage: ${state.meta.stage}`);
  const f = frontier(state);
  lines.push(f.length ? 'frontier:' : 'frontier: (empty)');
  for (const n of f) lines.push(`- ${n.id} ${line1(n.question)}`);
  return lines.join('\n');
}

export interface LogResult {
  state: DiscoverState;
  created: Created;
  frontier: DiscoverNode[];
  text: string;
  warnings: string[];
}

/** Validates, appends one line to interview.jsonl and regenerates the three markdown files, under the store lock. */
export function logDiscover(driverDir: string, raw: unknown, now: string): LogResult {
  if (!existsSync(path.join(driverDir, 'plan.json'))) throw new NotInitializedError(driverDir);
  const parsed = DiscoverInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new DiscoverRefusedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  const input = parsed.data;
  if (!input.meta && !input.nodes && !input.nonGoals) throw new DiscoverRefusedError('input needs at least one of meta, nodes, nonGoals');
  return withLock(driverDir, () => {
    const { state: before, kept, repair, dropped } = readState(driverDir);
    const { state, resolved, created } = applyInput(before, input, now);
    // everything is computed before the first write: a refusal above leaves every file as it was
    const interview = renderInterview(state);
    const assumptions = renderAssumptions(state);
    const nonGoals = renderNonGoals(state);
    const dir = discoverDir(driverDir);
    mkdirSync(dir, { recursive: true });
    const entry = `${JSON.stringify({ at: now, input: resolved, created } satisfies LogLine)}\n`;
    if (repair) atomicWrite(driverDir, logFile(driverDir), `${kept.map((l) => `${l}\n`).join('')}${entry}`);
    else appendFileSync(logFile(driverDir), entry);
    atomicWrite(driverDir, path.join(dir, 'interview.md'), interview);
    atomicWrite(driverDir, path.join(dir, 'assumptions.md'), assumptions);
    atomicWrite(driverDir, path.join(dir, 'non-goals.md'), nonGoals);
    const warnings = dropped ? ['dropped a truncated last line of interview.jsonl'] : [];
    const text = [summaryText(state, created), ...warnings.map((w) => `warning: ${w}`)].join('\n');
    return { state, created, frontier: frontier(state), text, warnings };
  });
}
