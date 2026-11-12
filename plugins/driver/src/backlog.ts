import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite, line1 } from './discover-log.js';
import { NotInitializedError, withLock } from './store.js';

/** ADR-016 addendum item 2: pending items for the next cycle, outside plan.json, as an append-only log plus a generated markdown. */

export const MAX_ITEMS = 20;

const decisionId = z.string().regex(/^D-\d{3,}$/, 'must look like D-001');
const text = z.string().refine((s) => s.trim() !== '', 'must not be empty');

const ItemInput = z.strictObject({
  title: text,
  detail: text.optional(),
  origin: text.optional(),
  decision: decisionId.optional(),
});

export const BacklogInputSchema = z.strictObject({
  items: z.array(ItemInput).min(1).max(MAX_ITEMS),
});

export type BacklogInput = z.infer<typeof BacklogInputSchema>;

export interface BacklogEntry {
  id: string;
  title: string;
  detail?: string;
  origin?: string;
  decision?: string;
  at: string;
}

/** The input was refused; nothing was written. */
export class BacklogRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacklogRefusedError';
  }
}

const logFile = (driverDir: string): string => path.join(driverDir, 'backlog.jsonl');
const mdFile = (driverDir: string): string => path.join(driverDir, 'backlog.md');

function nextNumber(entries: BacklogEntry[]): number {
  let max = 0;
  for (const e of entries) max = Math.max(max, Number(e.id.slice(2)) || 0);
  return max + 1;
}

const idOf = (n: number): string => `L-${String(n).padStart(2, '0')}`;

/** Reads backlog.jsonl; `exists` is false when there is no log yet. A torn (invalid JSON) last line is ignored. */
export function readBacklog(driverDir: string): { entries: BacklogEntry[]; exists: boolean; kept: string[]; repair: boolean; dropped: boolean } {
  const file = logFile(driverDir);
  if (!existsSync(file)) return { entries: [], exists: false, kept: [], repair: false, dropped: false };
  const lines = readFileSync(file, 'utf8').split('\n');
  const tail = lines[lines.length - 1]!;
  let dropped = false;
  let repair = false;
  if (tail.trim() !== '') {
    try {
      JSON.parse(tail);
      repair = true;
    } catch {
      dropped = true;
      repair = true;
      lines.pop();
    }
  }
  const kept: string[] = [];
  const entries: BacklogEntry[] = [];
  lines.forEach((l, i) => {
    if (l.trim() === '') return;
    kept.push(l);
    try {
      entries.push(JSON.parse(l) as BacklogEntry);
    } catch (e) {
      throw new Error(`${file}:${i + 1}: ${(e as Error).message}`);
    }
  });
  return { entries, exists: true, kept, repair, dropped };
}

const GENERATED = '<!-- Generated from backlog.jsonl by `driver backlog add`. Do not edit by hand. -->';

export function renderBacklog(entries: BacklogEntry[]): string {
  const out = [GENERATED, '', '# Backlog for the next cycle'];
  if (!entries.length) out.push('', '(empty)');
  for (const e of entries) {
    out.push('', `## ${e.id} ${line1(e.title)}`, '');
    out.push(`- Added: ${line1(e.at)}`);
    out.push(`- Origin: ${e.origin ? line1(e.origin) : '-'}`);
    out.push(`- Decision: ${e.decision ?? '-'}`);
    if (e.detail) out.push('', line1(e.detail));
  }
  return `${out.join('\n')}\n`;
}

export function showText(entries: BacklogEntry[]): string {
  if (!entries.length) return 'backlog: empty';
  return [`backlog: ${entries.length} item(s)`, ...entries.map((e) => `${e.id} ${line1(e.title)}${e.origin ? ` [${line1(e.origin)}]` : ''}${e.decision ? ` (${e.decision})` : ''}`)].join('\n');
}

export interface AddResult {
  created: string[];
  entries: BacklogEntry[];
  text: string;
  warnings: string[];
}

/** Validates, appends one line per item to backlog.jsonl and regenerates backlog.md, under the store lock. Never touches plan.json. */
export function addBacklog(driverDir: string, raw: unknown, now: string): AddResult {
  if (!existsSync(path.join(driverDir, 'plan.json'))) throw new NotInitializedError(driverDir);
  const parsed = BacklogInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new BacklogRefusedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return withLock(driverDir, () => {
    const { entries: before, kept, repair, dropped } = readBacklog(driverDir);
    let n = nextNumber(before);
    const added: BacklogEntry[] = parsed.data.items.map((it) => ({
      id: idOf(n++),
      title: it.title,
      ...(it.detail !== undefined ? { detail: it.detail } : {}),
      ...(it.origin !== undefined ? { origin: it.origin } : {}),
      ...(it.decision !== undefined ? { decision: it.decision } : {}),
      at: now,
    }));
    const entries = [...before, ...added];
    const md = renderBacklog(entries);
    const lines = added.map((e) => `${JSON.stringify(e)}\n`).join('');
    if (repair) atomicWrite(driverDir, logFile(driverDir), `${kept.map((l) => `${l}\n`).join('')}${lines}`);
    else appendFileSync(logFile(driverDir), lines);
    atomicWrite(driverDir, mdFile(driverDir), md);
    const created = added.map((e) => e.id);
    const warnings = dropped ? ['dropped a truncated last line of backlog.jsonl'] : [];
    const textOut = [`ok; created ${created.join(', ')}`, `backlog: ${entries.length} item(s)`, ...warnings.map((w) => `warning: ${w}`)].join('\n');
    return { created, entries, text: textOut, warnings };
  });
}
