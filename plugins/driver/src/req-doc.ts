import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REQ_HEADINGS, bodyOf, bodyProblem, setSection } from './md-sections.js';
import { readPlan, withLock } from './store.js';

/** Silent filling of requirements/<id>.md sections. Never touches plan.json, the revision or the ledger. */

const SECTIONS = [
  { key: 'statement', heading: 'Statement' },
  { key: 'acceptance', heading: 'Acceptance signal' },
  { key: 'origin', heading: 'Origin' },
  { key: 'notes', heading: 'Notes' },
] as const;

const Entry = z.strictObject({
  id: z.string().regex(/^R-\d+$/, 'must look like R-003'),
  statement: z.string().optional(),
  acceptance: z.string().optional(),
  origin: z.string().optional(),
  notes: z.string().optional(),
});

export const ReqDocInputSchema = z.strictObject({ requirements: z.array(Entry).min(1).max(30) });

export type ReqDocEntry = z.infer<typeof Entry>;

/** The input was refused; nothing was written. */
export class ReqDocRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReqDocRefusedError';
  }
}

const refuse = (m: string): never => {
  throw new ReqDocRefusedError(m);
};

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t;
    }
  }
  return t.replace(/^'(.*)'$/, '$1');
};

/** Makes sure id, title, kind and source are present and match the plan; other keys and their order stay. */
export function syncFrontmatter(content: string, want: Record<'id' | 'title' | 'kind' | 'source', string>): string {
  const lines = content.split('\n');
  const render = (k: keyof typeof want): string => `${k}: ${k === 'title' ? JSON.stringify(want[k]) : want[k]}`;
  const keys = ['id', 'title', 'kind', 'source'] as const;
  if (lines[0] !== '---') return `---\n${keys.map(render).join('\n')}\n---\n\n${content.replace(/^\n+/, '')}`;
  const close = lines.indexOf('---', 1);
  if (close < 0) return content;
  const fm = lines.slice(1, close);
  for (const k of keys) {
    const i = fm.findIndex((l) => l.startsWith(`${k}:`));
    if (i < 0) fm.push(render(k));
    else if (unquote(fm[i]!.slice(k.length + 1)) !== want[k]) fm[i] = render(k);
  }
  return [lines[0], ...fm, ...lines.slice(close)].join('\n');
}

export function reqDocTemplate(id: string, title: string): string {
  return `# ${id} ${title}\n`;
}

export function renderReqDoc(current: string, e: ReqDocEntry, fail: (m: string) => never = refuse): string {
  let lines = current.replace(/\r\n/g, '\n').split('\n');
  const H = REQ_HEADINGS;
  if (e.statement !== undefined) lines = setSection(lines, H, 'Statement', bodyOf(e.statement), fail);
  if (e.acceptance !== undefined) lines = setSection(lines, H, 'Acceptance signal', bodyOf(e.acceptance), fail);
  if (e.origin !== undefined) lines = setSection(lines, H, 'Origin', bodyOf(e.origin), fail);
  if (e.notes !== undefined) lines = setSection(lines, H, 'Notes', bodyOf(e.notes), fail);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const label = (e: ReqDocEntry): string[] => SECTIONS.flatMap((s) => (e[s.key] === undefined ? [] : [s.key]));

export interface ReqDocResult {
  requirements: { id: string; sections: string[]; created: boolean }[];
  text: string;
}

export function writeReqDocs(driverDir: string, raw: unknown): ReqDocResult {
  const parsed = ReqDocInputSchema.safeParse(raw);
  if (!parsed.success) throw new ReqDocRefusedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return withLock(driverDir, () => {
    const plan = readPlan(driverDir);
    const seen = new Set<string>();
    const staged = parsed.data.requirements.map((e, i) => {
      const fail = (m: string): never => refuse(`requirements[${i}] (${e.id}): ${m}`);
      if (seen.has(e.id)) fail('listed twice');
      seen.add(e.id);
      const r = plan.requirements[e.id];
      if (!r) return fail(`unknown requirement ${e.id}`);
      if (r.retired) fail('requirement is retired');
      if (label(e).length === 0) fail('nothing to write (give statement, acceptance, origin or notes)');
      for (const s of SECTIONS) {
        const p = e[s.key] === undefined ? undefined : bodyProblem(e[s.key]!, REQ_HEADINGS);
        if (p) fail(`${s.key}: ${p}`);
      }
      const file = path.join(driverDir, 'requirements', `${e.id}.md`);
      const existed = existsSync(file);
      const base = existed ? readFileSync(file, 'utf8') : reqDocTemplate(e.id, r.title);
      const content = syncFrontmatter(renderReqDoc(base, e, fail), { id: e.id, title: r.title, kind: r.kind, source: r.source });
      return { id: e.id, file, existed, content, sections: label(e) };
    });
    mkdirSync(path.join(driverDir, 'requirements'), { recursive: true });
    mkdirSync(path.join(driverDir, '.tmp'), { recursive: true });
    for (const s of staged) {
      const tmp = path.join(driverDir, '.tmp', `${s.id}.req.md.${process.pid}`);
      writeFileSync(tmp, s.content);
      renameSync(tmp, s.file);
    }
    const requirements = staged.map((s) => ({ id: s.id, sections: s.sections, created: !s.existed }));
    return { requirements, text: requirements.map((b) => `${b.id}: ${b.sections.join(', ')}`).join('\n') };
  });
}
