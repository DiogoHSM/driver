import type { On } from 'claude-code'

import { BLOCK_STATUSES, STATUS_LABEL } from '../src/shared/phases.js'
import { summarize } from '../src/shared/view.js'
import type { DriverGateName, DriverView } from '../types'
import { approveViaMod } from './approve.js'
import { refusal, runCli, type Dollar } from './cli.js'
import { PANE_ID, ensurePoller, forceTick, getPaths, refreshPaths, getView } from './state.js'

const GATES: readonly string[] = ['route', 'release']

export async function openPane($: Dollar, isFocused = false): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: 'DRIVER', columns: 72, closeOnEscape: true, ...(isFocused ? { focus: true as const } : {}) })
}

export async function initPlan($: Dollar, name: string): Promise<{ ok: boolean; message: string }> {
  const paths = await getPaths($)
  const fallback = paths?.root.split('/').filter(Boolean).pop() ?? 'project'
  const n = name.trim() || fallback
  const r = await runCli($, ['init', n])
  if (!r.ok) return { ok: false, message: refusal(r) }
  await refreshPaths($)
  await forceTick($)
  return { ok: true, message: `Initialized DRIVER plan "${n}".` }
}

export async function exportMermaid($: Dollar): Promise<{ ok: boolean; message: string; path?: string }> {
  const r = await runCli($, ['export', 'mermaid'])
  const path = (r.json as { path?: string } | undefined)?.path
  if (!r.ok || !path) return { ok: false, message: refusal(r) }
  return { ok: true, message: `Mermaid diagram written to ${path}`, path }
}

export function statusText(view: DriverView | null, root?: string): string {
  if (!view) return `No DRIVER plan${root ? ` in ${root}` : ''}. Run /driver init <name> to start one.`
  const s = summarize(view)
  const gate = (g: DriverGateName) => (view.gates[g].approved ? `${g} approved${view.gates[g].by ? ` (${view.gates[g].by})` : ''}` : `${g} pending`)
  const counts = BLOCK_STATUSES.filter((st) => s.counts[st] > 0)
    .map((st) => `${STATUS_LABEL[st]} ${s.counts[st]}`)
    .join(', ')
  const lines = [
    `DRIVER ${view.project}: phase ${view.currentPhase}, revision ${view.revision}, baseline ${view.baseline}`,
    `gates: ${gate('route')}; ${gate('release')}`,
    `blocks: ${view.blocks.filter((b) => !b.retired).length} active${counts ? ` (${counts})` : ''}`,
  ]
  if (s.ready.length) lines.push(`ready: ${s.ready.join(', ')}`)
  if (s.blocked.length) lines.push(`blocked: ${s.blocked.map((b) => b.id).join(', ')}`)
  return lines.join('\n')
}

const NOT_TYPED =
  'DRIVER: approval must be typed by you at the prompt (/driver approve <route|release>). If you did type it, use the Approve button in the DRIVER pane instead.'

export function registerCommand(on: On): void {
  on('command.run', { command: 'driver' }, async ($, e) => {
    ensurePoller($)
    const [sub = 'status', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)

    if (sub === 'status') {
      await openPane($).catch(() => undefined)
      await forceTick($).catch(() => undefined)
      const view = await getView($)
      return { text: statusText(view, (await getPaths($))?.root) }
    }
    if (sub === 'export') {
      const r = await exportMermaid($)
      if (!r.ok || !r.path) return { text: r.message }
      const mermaid = await $.fs.read(r.path).catch(() => '')
      return { text: `${r.message}\n\n\`\`\`mermaid\n${String(mermaid).trimEnd()}\n\`\`\`` }
    }
    if (sub === 'init') {
      const r = await initPlan($, rest.join(' '))
      return { text: r.message }
    }
    if (sub === 'approve') {
      // Only the person's own Enter at the prompt may approve: the model cannot raise a composer command.
      if (e.origin.kind !== 'composer') return { text: NOT_TYPED }
      const gate = rest[0]
      if (!gate || !GATES.includes(gate)) return { text: 'Usage: /driver approve <route|release>' }
      const r = await approveViaMod($, gate as DriverGateName)
      return {
        text: r.message,
        ...(r.ok ? { context: [`User approved gate ${gate} via /driver at rev ${r.seenRevision ?? '?'}`] } : {}),
      }
    }
    return { text: 'Usage: /driver [status|export|init <name>|approve <route|release>]' }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'DRIVER: the command failed unexpectedly.' }))
}
