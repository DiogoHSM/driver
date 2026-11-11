/**
 * Section handling for the generated block and requirement documents. A section ends only at the
 * next line that is exactly one of the document type's known `## <heading>` lines outside a code
 * fence (or at end of file), so caller text can never split or forge a section.
 */

export const BLOCK_HEADINGS = ['Spec', 'Acceptance criteria', 'Notes', 'Handoff'] as const;
export const REQ_HEADINGS = ['Statement', 'Acceptance signal', 'Origin', 'Notes'] as const;

export type Fail = (message: string) => never;

const FENCE = /^\s{0,3}(```|~~~)/;

/** Fence state is toggled by any line opening or closing a ``` or ~~~ fence. */
function fenceFlags(lines: readonly string[]): boolean[] {
  let open = false;
  return lines.map((l) => {
    const inside = open;
    if (FENCE.test(l)) open = !open;
    return inside || FENCE.test(l);
  });
}

export interface Found {
  heading: string;
  start: number;
  /** Exclusive: the next known heading, or the end of the document. */
  end: number;
}

export function findSections(lines: readonly string[], headings: readonly string[]): Found[] {
  const fenced = fenceFlags(lines);
  const starts: { heading: string; start: number }[] = [];
  lines.forEach((l, i) => {
    if (fenced[i]) return;
    const m = /^##\s+(.*?)\s*$/.exec(l);
    const h = m ? headings.find((x) => x === m[1]) : undefined;
    if (h) starts.push({ heading: h, start: i });
  });
  return starts.map((s, i) => ({ ...s, end: starts[i + 1]?.start ?? lines.length }));
}

/** The one section with this heading, or undefined; two or more is a refusal. */
export function findOne(lines: readonly string[], headings: readonly string[], heading: string, fail: Fail): Found | undefined {
  const all = findSections(lines, headings).filter((s) => s.heading === heading);
  if (all.length > 1) fail(`duplicate ## ${heading} heading`);
  return all[0];
}

/** Why caller text cannot be a section body, or undefined when it can. */
export function bodyProblem(text: string, headings: readonly string[]): string | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fenced = fenceFlags(lines);
  for (const [i, l] of lines.entries()) {
    if (fenced[i]) continue;
    const m = /^##\s+(.*?)\s*$/.exec(l);
    if (m && headings.includes(m[1]!)) return `text has the section heading line "${l.trim()}"; use ### or plain text`;
    if (/^#{1,2}\s/.test(l)) return `text has a line starting with # or ## ("${l.trim().slice(0, 40)}"); use ### or plain text`;
  }
  const opens = lines.filter((l) => FENCE.test(l)).length;
  if (opens % 2 === 1) return 'text has an unclosed code fence';
  return undefined;
}

export const bodyOf = (text: string): string[] => text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').split('\n');

/** Replaces the body of one section, or adds the section in canonical order. */
export function setSection(lines: string[], headings: readonly string[], heading: string, body: string[], fail: Fail): string[] {
  const out = [...lines];
  const block = ['', ...body, ''];
  const cur = findOne(out, headings, heading, fail);
  if (cur) {
    out.splice(cur.start + 1, cur.end - cur.start - 1, ...block);
    return out;
  }
  const at = headings.indexOf(heading);
  const lookup = (h: string): Found | undefined => findOne(out, headings, h, fail);
  const before = headings.slice(0, at).reverse().map(lookup).find((r) => r);
  const after = headings.slice(at + 1).map(lookup).find((r) => r);
  const pos = before ? before.end : after ? after.start : out.length;
  const prefix = pos > 0 && out[pos - 1]!.trim() !== '' ? [''] : [];
  out.splice(pos, 0, ...prefix, `## ${heading}`, ...block);
  return out;
}

/** The lines under the one `## <heading>`; undefined when there is none. Throws through `fail` on duplicates. */
export function sectionText(content: string, headings: readonly string[], heading: string, fail: Fail): string[] | undefined {
  const lines = content.split('\n');
  const s = findOne(lines, headings, heading, fail);
  return s ? lines.slice(s.start + 1, s.end) : undefined;
}
