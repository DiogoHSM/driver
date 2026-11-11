import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BLOCK_HEADINGS, bodyOf, bodyProblem, setSection } from './md-sections.js';
import { blockDocTemplate, readPlan, withLock } from './store.js';

/** Silent filling of blocks/<id>.md sections. Never touches plan.json, the revision or the ledger. */

const SECTIONS = [
  { key: 'spec', heading: 'Spec' },
  { key: 'acceptance', heading: 'Acceptance criteria' },
  { key: 'notes', heading: 'Notes' },
  { key: 'handoff', heading: 'Handoff' },
] as const;

const Entry = z.strictObject({
  id: z.string().regex(/^B-\d+$/, 'must look like B-004'),
  spec: z.string().optional(),
  acceptance: z.array(z.string()).optional(),
  notes: z.string().optional(),
  handoff: z.string().optional(),
});

export const BlockDocInputSchema = z.strictObject({ blocks: z.array(Entry).min(1).max(30) });

export type BlockDocEntry = z.infer<typeof Entry>;

/** The input was refused; nothing was written. */
export class BlockDocRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockDocRefusedError';
  }
}

const refuse = (m: string): never => {
  throw new BlockDocRefusedError(m);
};

const CHECKBOX = /^- \[[ xX]\]/;

const checklist = (items: string[]): string[] => items.map((i) => i.replace(/[\r\n\u2028\u2029\u0085]+/g, ' ').trim()).map((i) => (CHECKBOX.test(i) ? i : `- [ ] ${i}`));

export function renderDoc(current: string, e: BlockDocEntry, fail: (m: string) => never = refuse): string {
  let lines = current.replace(/\r\n/g, '\n').split('\n');
  const H = BLOCK_HEADINGS;
  if (e.spec !== undefined) lines = setSection(lines, H, 'Spec', bodyOf(e.spec), fail);
  if (e.acceptance !== undefined) lines = setSection(lines, H, 'Acceptance criteria', checklist(e.acceptance), fail);
  if (e.notes !== undefined) lines = setSection(lines, H, 'Notes', bodyOf(e.notes), fail);
  if (e.handoff !== undefined) lines = setSection(lines, H, 'Handoff', bodyOf(e.handoff), fail);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export interface BlockDocResult {
  blocks: { id: string; sections: string[]; created: boolean }[];
  text: string;
}

function label(e: BlockDocEntry): string[] {
  return SECTIONS.flatMap((s) => {
    const v = e[s.key];
    if (v === undefined) return [];
    return [s.key === 'acceptance' ? `acceptance (${(v as string[]).length})` : s.key];
  });
}

export function writeBlockDocs(driverDir: string, raw: unknown): BlockDocResult {
  const parsed = BlockDocInputSchema.safeParse(raw);
  if (!parsed.success) throw new BlockDocRefusedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  const entries = parsed.data.blocks;
  return withLock(driverDir, () => {
    const plan = readPlan(driverDir);
    const seen = new Set<string>();
    const staged = entries.map((e, i) => {
      const where = `blocks[${i}] (${e.id})`;
      const fail = (m: string): never => refuse(`${where}: ${m}`);
      if (seen.has(e.id)) fail('listed twice');
      seen.add(e.id);
      const b = plan.blocks[e.id];
      if (!b) return fail(`unknown block ${e.id}`);
      if (b.retired) fail('block is retired');
      if (b.status === 'done') fail('block is done; its document is frozen');
      if (b.status === 'in_review' && e.handoff !== undefined) fail('block is in_review; the handoff cannot be rewritten (the path back is needs_rework)');
      if (label(e).length === 0) fail('nothing to write (give spec, acceptance, notes or handoff)');
      for (const key of ['spec', 'notes', 'handoff'] as const) {
        const p = e[key] === undefined ? undefined : bodyProblem(e[key]!, BLOCK_HEADINGS);
        if (p) fail(`${key}: ${p}`);
      }
      for (const item of e.acceptance ?? []) {
        if (item.trim() === '') fail('acceptance entries cannot be empty');
        const p = bodyProblem(item, BLOCK_HEADINGS);
        if (p) fail(`acceptance: ${p}`);
      }
      const file = path.join(driverDir, 'blocks', `${e.id}.md`);
      const existed = existsSync(file);
      const current = existed ? readFileSync(file, 'utf8') : blockDocTemplate(e.id, b.title);
      return { id: e.id, file, existed, content: renderDoc(current, e, fail), sections: label(e) };
    });
    // every entry is validated and rendered before the first write
    mkdirSync(path.join(driverDir, 'blocks'), { recursive: true });
    mkdirSync(path.join(driverDir, '.tmp'), { recursive: true });
    for (const s of staged) {
      const tmp = path.join(driverDir, '.tmp', `${s.id}.md.${process.pid}`);
      writeFileSync(tmp, s.content);
      renameSync(tmp, s.file);
    }
    const blocks = staged.map((s) => ({ id: s.id, sections: s.sections, created: !s.existed }));
    return { blocks, text: blocks.map((b) => `${b.id}: ${b.sections.join(', ')}`).join('\n') };
  });
}
