import type { Elements, On } from 'claude-code'

import { PHASES, STATUS_LABEL, type PhaseId } from '../src/shared/phases.js'
import { paneRows } from '../src/shared/rows.js'
import type { DriverDetail, DriverGateName, DriverLoad, DriverPaths, DriverUi, DriverView } from '../types'
import { approveViaMod } from './approve.js'
import { refusal, runCli, type Dollar } from './cli.js'
import { exportMermaid, initPlan } from './command.js'
import { boardDetail, boardHeader, boardView, type BoardKit } from './render-board.js'
import { diagramView, type SvgKit } from './render-svg.js'
import { rowsView, type Kit } from './render-terminal.js'
import {
  PANE_ID,
  clearDetail,
  getAlerts,
  getDetail,
  getLoad,
  getStoredPaths,
  getUi,
  getView,
  ensurePoller,
  forceTick,
  loadDetail,
  setNotice,
  setUi,
} from './state.js'

type RichKit = Kit & Partial<Pick<Elements['desktop'], 'Input' | 'Select' | 'Svg'>>

interface Snapshot {
  paths: DriverPaths | null
  load: DriverLoad
  view: DriverView | null
  ui: DriverUi
  detail: DriverDetail | null
  alerts: string[]
}

async function snapshot($: Dollar): Promise<Snapshot> {
  const [paths, load, view, ui, detail, alerts] = await Promise.all([
    getStoredPaths($),
    getLoad($),
    getView($),
    getUi($),
    getDetail($),
    getAlerts($),
  ])
  return { paths, load, view, ui, detail, alerts }
}

// ---------------------------------------------------------------- actions

function actionsOf($: Dollar) {
  const select = async (id: string) => {
    const view = await getView($)
    await setUi($, { selected: id, notice: null })
    if (view) await loadDetail($, id, view.revision)
  }
  const askApprove = async (gate: DriverGateName) => {
    const view = await getView($)
    if (view) await setUi($, { confirm: { gate, revision: view.revision, baseline: view.baseline }, notice: null })
  }
  return {
    setFocus: (f: DriverUi['focus']) => setUi($, { focus: f, notice: null }),
    cycleFocus: async () => {
      const order: DriverUi['focus'][] = ['auto', 'all', ...PHASES]
      const ui = await getUi($)
      await setUi($, { focus: order[(order.indexOf(ui.focus) + 1) % order.length]!, notice: null })
    },
    primary: async (p: Primary) => {
      if (p.run === 'approve-route') return askApprove('route')
      if (p.run === 'approve-release') return askApprove('release')
      const r = await runCli($, ['phase', 'advance'])
      await setNotice($, r.ok ? null : refusal(r))
      $.ui.toast(r.ok ? `Advanced to ${p.to}.` : refusal(r))
      if (r.ok) await forceTick($)
    },
    toggleDone: async () => {
      const ui = await getUi($)
      await setUi($, { collapseDone: !ui.collapseDone })
    },
    toggleRetired: async () => {
      const ui = await getUi($)
      await setUi($, { showRetired: !ui.showRetired })
    },
    select,
    goto: async (raw: string) => {
      const id = raw.trim().toUpperCase()
      const view = await getView($)
      if (view?.blocks.some((b) => b.id === id)) await select(id)
      else await setNotice($, `No block ${id || '(empty)'} in this plan.`)
    },
    closeDetail: async () => {
      await setUi($, { selected: null })
      await clearDetail($)
    },
    setInitName: (v: string) => setUi($, { initName: v }),
    init: async (name?: string) => {
      const ui = await getUi($)
      const r = await initPlan($, name ?? ui.initName)
      await setNotice($, r.ok ? null : r.message)
      $.ui.toast(r.message)
    },
    exportPlan: async () => {
      const r = await exportMermaid($)
      await setUi($, { exportPath: r.path ?? null, notice: r.ok ? null : r.message })
    },
    copyPath: async (surface?: string) => {
      const ui = await getUi($)
      if (ui.exportPath) await $.ui.copy({ text: ui.exportPath, ...(surface ? { surface: surface as 'terminal' } : {}) })
    },
    retry: () => forceTick($),
    askApprove,
    cancelApprove: () => setUi($, { confirm: null }),
    // A press is person-initiated, so this is the one pane path to approval.
    confirmApprove: async () => {
      const ui = await getUi($)
      const c = ui.confirm
      if (!c) return
      await setUi($, { confirm: null })
      const r = await approveViaMod($, c.gate, c.revision)
      await setNotice($, r.ok ? null : r.message)
      $.ui.toast(r.message)
    },
  }
}

type Actions = ReturnType<typeof actionsOf>

// ---------------------------------------------------------------- pieces

const FOCUS_LABEL: Record<string, string> = { auto: 'current phase (auto)', all: 'all phases' }
const focusLabel = (f: string) => FOCUS_LABEL[f] ?? f

const FOCUS_OPTIONS = [
  { value: 'auto', label: FOCUS_LABEL.auto! },
  { value: 'all', label: FOCUS_LABEL.all! },
  ...PHASES.map((p) => ({ value: p, label: p })),
]

type Primary = { label: string; run: 'approve-route' | 'approve-release' | 'advance'; to?: PhaseId }

/** The one contextual action: approve a gate where the method asks for it, or advance when the next phase is open. */
export function primaryAction(view: DriverView): Primary | null {
  const cur = view.currentPhase
  if (cur === 'discover' && !view.gates.route.approved) return { label: 'Approve route gate', run: 'approve-route' }
  if (cur === 'evolve' && !view.gates.release.approved) return { label: 'Approve release gate', run: 'approve-release' }
  const next = PHASES[PHASES.indexOf(cur) + 1]
  if (!next) return null
  const guard = next === 'route' ? view.gates.route : next === 'release' ? view.gates.release : null
  if (guard && !guard.approved) return null
  return { label: `Advance to ${next}`, run: 'advance', to: next }
}

function headerView(kit: Kit, s: Snapshot) {
  const { Box, Text } = kit
  const view = s.view
  if (!view) return null
  const gate = (g: DriverGateName) => {
    const v = view.gates[g]
    return `gate ${g}: ${v.approved ? `✓ approved${v.by ? ` by ${v.by}` : ''}` : 'pending'}`
  }
  return (
    <Box flexDirection="column">
      <Text bold>{`DRIVER · ${view.project} · phase ${view.currentPhase} · rev ${view.revision} · baseline ${view.baseline}`}</Text>
      <Text dimColor>{`${gate('route')}   ${gate('release')}`}</Text>
    </Box>
  )
}

const cutLabel = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join('')}…` : s)

/** A Select lists at most this many options; past it the picker is a typed id. */
const SELECT_MAX = 64

/** The block picker beside the drawing (presses on the SVG never reach the plugin): a Select over the drawn blocks, or a typed id when there are too many for one. */
function blockPicker(kit: RichKit, s: Snapshot, a: Actions, drawn: string[]) {
  const view = s.view
  const { Select, Input } = kit
  if (!view || !Select || drawn.length === 0) return null
  if (drawn.length > SELECT_MAX)
    return Input ? (
      <Input key="block-goto" label="Block" placeholder={drawn[0]} value="" submitLabel="open" onSubmit={(v) => a.goto(v)} />
    ) : null
  const title = new Map(view.blocks.map((b) => [b.id, b.title]))
  return (
    <Select
      key="block"
      options={drawn.map((id) => ({ value: id, label: `${id} · ${cutLabel(title.get(id) ?? '', 36)}` }))}
      {...(s.ui.selected && drawn.includes(s.ui.selected) ? { value: s.ui.selected } : {})}
      onSelect={(v) => a.select(v)}
    />
  )
}

/**
 * Two rows that wrap on a narrow pane. First: what the drawing shows (focus and the two toggles, with
 * explicit verbs). Second: the block picker on drawing surfaces and, pushed to the right, the one
 * contextual action.
 */
function toolbar(kit: RichKit, s: Snapshot, a: Actions, canSelect: boolean, drawn: string[] | null) {
  const { Box, Button, Text } = kit
  const view = s.view
  if (!view) return null
  const Select = canSelect ? kit.Select : undefined
  const primary = primaryAction(view)
  const picker = canSelect && drawn ? blockPicker(kit, s, a, drawn) : null
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="sm">
        <Text dimColor>Show</Text>
        {Select ? (
          <Select key="focus" options={FOCUS_OPTIONS} value={s.ui.focus} onSelect={(v) => a.setFocus(v as DriverUi['focus'])} />
        ) : (
          <Button key="focus" variant="secondary" onPress={() => a.cycleFocus()}>
            {focusLabel(s.ui.focus)}
          </Button>
        )}
        <Button key="done" variant="secondary" onPress={() => a.toggleDone()}>
          {s.ui.collapseDone ? 'Show done' : 'Hide done'}
        </Button>
        <Button key="retired" variant="secondary" onPress={() => a.toggleRetired()}>
          {s.ui.showRetired ? 'Hide retired' : 'Show retired'}
        </Button>
      </Box>
      {(picker || primary) && (
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="sm">
          {picker && <Text dimColor>Open</Text>}
          {picker}
          <Box flexGrow={1} />
          {primary && (
            <Button key="action" hotkey="g" variant="primary" onPress={() => a.primary(primary)}>
              {primary.label}
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
}

function controls(kit: RichKit, s: Snapshot, a: Actions, canSelect: boolean) {
  const { Box, Button } = kit
  const view = s.view
  if (!view) return null
  const Select = canSelect ? kit.Select : undefined
  const primary = primaryAction(view)
  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {Select ? (
        <Select key="focus" label="Focus" options={FOCUS_OPTIONS} value={s.ui.focus} onSelect={(v) => a.setFocus(v as DriverUi['focus'])} />
      ) : (
        <Button key="focus" onPress={() => a.cycleFocus()}>
          {`Focus: ${focusLabel(s.ui.focus)}`}
        </Button>
      )}
      <Button key="done" onPress={() => a.toggleDone()}>
        {s.ui.collapseDone ? 'Show done' : 'Hide done'}
      </Button>
      <Button key="retired" onPress={() => a.toggleRetired()}>
        {s.ui.showRetired ? 'Hide retired' : 'Show retired'}
      </Button>
      <Button key="export" onPress={() => a.exportPlan()}>
        Export Mermaid
      </Button>
      {primary && (
        <Button key="action" hotkey="g" variant="primary" onPress={() => a.primary(primary)}>
          {primary.label}
        </Button>
      )}
    </Box>
  )
}

function notices(kit: Kit, s: Snapshot, a: Actions, surface: string) {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column">
      {s.ui.notice && <Text color="yellow">{s.ui.notice}</Text>}
      {s.ui.exportPath && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`Exported: ${s.ui.exportPath}`}</Text>
          <Button key="copy" onPress={() => a.copyPath(surface)}>
            Copy path
          </Button>
        </Box>
      )}
    </Box>
  )
}

function confirmView(kit: Kit, s: Snapshot, a: Actions) {
  const { Box, Text, Button } = kit
  const c = s.ui.confirm
  if (!c) return null
  return (
    <Box flexDirection="column">
      <Text color="yellow">{`Approve ${c.gate} gate at revision ${c.revision} (baseline ${c.baseline})?`}</Text>
      <Box flexDirection="row" gap={1}>
        <Button key="confirm-yes" variant="primary" onPress={() => a.confirmApprove()}>
          Approve
        </Button>
        <Button key="confirm-no" hotkey="n" onPress={() => a.cancelApprove()}>
          Cancel
        </Button>
      </Box>
    </Box>
  )
}

function detailView(kit: Kit, s: Snapshot, a: Actions) {
  const { Box, Text, Button, Markdown } = kit
  const d = s.detail
  const b = d && s.view?.blocks.find((x) => x.id === d.id)
  if (!d || !b) return null
  const meta = [
    `${STATUS_LABEL[b.status]} since ${b.since}`,
    b.owner ? `owner ${b.owner}` : '',
    b.deps.length ? `depends on ${b.deps.join(', ')}` : '',
    `${b.reqs} req, tests ${b.tests.pass} pass / ${b.tests.fail} fail / ${b.tests.unknown} unknown`,
  ].filter(Boolean)
  return (
    <Box flexDirection="column">
      <Text bold>{`${b.id} ${b.title}`}</Text>
      <Text dimColor>{meta.join(' · ')}</Text>
      {b.reason && <Text color="red">{`reason: ${b.reason}`}</Text>}
      <Markdown key="detail-doc" text={d.doc} />
      {d.isTruncated && <Text dimColor>(document cut at 6000 characters)</Text>}
      <Button key="close-detail" hotkey="x" onPress={() => a.closeDetail()}>
        Close detail
      </Button>
    </Box>
  )
}

function emptyView(kit: RichKit, s: Snapshot, a: Actions, canType: boolean) {
  const { Box, Text, Button } = kit
  const Input = canType ? kit.Input : undefined
  const root = s.paths?.root ?? ''
  const fallback = root.split('/').filter(Boolean).pop() ?? 'project'
  return (
    <Box flexDirection="column">
      <Text>{`No DRIVER plan in ${root || 'this project'}.`}</Text>
      {Input && (
        <Input
          key="init-name"
          label="Project name"
          placeholder={fallback}
          value={s.ui.initName}
          submitLabel="initialize"
          onInput={(v) => a.setInitName(v)}
          onSubmit={(v) => a.init(v)}
        />
      )}
      <Button key="init" hotkey="i" variant="primary" onPress={() => a.init()}>
        Initialize
      </Button>
    </Box>
  )
}

function invalidView(kit: Kit, load: Extract<DriverLoad, { kind: 'invalid' }>, a: Actions) {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column">
      <Text color="red" bold>
        {`The plan is invalid (${load.issues.length} issue${load.issues.length === 1 ? '' : 's'}).${load.lastGoodRev !== null ? ` Showing the last good view, stale since revision ${load.lastGoodRev}.` : ''}`}
      </Text>
      {load.issues.slice(0, 10).map((i, n) => (
        <Text key={`issue-${n}`} color={i.level === 'error' ? 'red' : 'yellow'}>
          {`${i.level} [${i.code}] ${i.path}: ${i.message}`}
        </Text>
      ))}
      {load.issues.length > 10 && <Text dimColor>{`... and ${load.issues.length - 10} more`}</Text>}
      <Button key="retry" onPress={() => a.retry()}>
        Check again
      </Button>
    </Box>
  )
}

// ---------------------------------------------------------------- the block list

function boardList(kit: RichKit, s: Snapshot, a: Actions, isDim: boolean) {
  if (!s.view) return null
  const list = paneRows(s.view, {
    bodyColumns: 72,
    focus: s.ui.focus,
    collapseDone: s.ui.collapseDone,
    showRetired: s.ui.showRetired,
    ...(s.ui.selected ? { selected: s.ui.selected } : {}),
  })
  return boardView(
    kit as unknown as BoardKit,
    list,
    { select: (id) => a.select(id), expandDone: () => a.toggleDone(), expandPhase: (p) => a.setFocus(p), selected: s.ui.selected },
    isDim,
  )
}

function blockList(kit: Kit, s: Snapshot, a: Actions, bodyColumns: number, rows: number | undefined, isDim: boolean) {
  if (!s.view) return null
  const list = paneRows(s.view, {
    bodyColumns,
    ...(rows !== undefined ? { rows } : {}),
    focus: s.ui.focus,
    collapseDone: s.ui.collapseDone,
    showRetired: s.ui.showRetired,
    ...(s.ui.selected ? { selected: s.ui.selected } : {}),
  })
  return rowsView(
    kit,
    list,
    { select: (id) => a.select(id), expandDone: () => a.toggleDone(), expandPhase: (p) => a.setFocus(p), selected: s.ui.selected },
    isDim,
  )
}

// ---------------------------------------------------------------- the pane

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'driver' }, async ($, e) => {
    ensurePoller($)
    const s = await snapshot($)
    const a = actionsOf($)
    const bodyColumns = e.props.bodyColumns
    const rows = e.viewport?.rows ?? 24

    const kit = $.ui.resolve(e) as RichKit
    const { Box, Text, Button } = kit
    const isTerminal = e.surface === 'terminal'
    // mobile draws no Input or Select, whatever the table lists
    const canType = e.surface !== 'mobile'
    // desktop and vscode draw the diagram at the pane's width; the phone keeps the card board
    const drawsSvg = !isTerminal && canType && typeof kit.Svg === 'function'
    const view = s.view
    const isStale = s.load.kind === 'invalid'

    let body: ReturnType<typeof rowsView> | null = null
    if (s.load.kind === 'error' && !view) {
      body = (
        <Box flexDirection="column">
          <Text color="red">{`DRIVER could not read the plan: ${s.load.message}`}</Text>
          <Button key="retry" onPress={() => a.retry()}>
            Retry
          </Button>
        </Box>
      )
    } else if (!view && s.load.kind === 'invalid') {
      body = invalidView(kit, s.load, a)
    } else if (!view && !s.paths) {
      body = <Text dimColor>Resolving the project...</Text>
    } else if (!view) {
      body = emptyView(kit, s, a, canType)
    } else {
      // the diagram comes first: the toolbar's block picker lists what it drew
      const diagram = drawsSvg ? diagramView(kit as unknown as SvgKit, view, s.ui, bodyColumns) : null
      body = (
        <Box flexDirection="column">
          {isStale && s.load.kind === 'invalid' && invalidView(kit, s.load, a)}
          {isTerminal ? headerView(kit, s) : boardHeader(kit as unknown as BoardKit, view, () => a.exportPlan())}
          {isTerminal ? controls(kit, s, a, canType) : toolbar(kit, s, a, canType, diagram?.blockIds ?? null)}
          {isTerminal ? blockList(kit, s, a, bodyColumns, rows, isStale) : (diagram?.node ?? boardList(kit, s, a, isStale))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {s.alerts.map((text, i) => (
          <Text key={`alert-${i}`} color="red" bold>
            {text}
          </Text>
        ))}
        {body}
        {confirmView(kit, s, a)}
        {notices(kit, s, a, e.surface)}
        {isTerminal || !view ? detailView(kit, s, a) : boardDetail(kit as unknown as BoardKit, view, s.detail, () => a.closeDetail())}
      </Box>
    )
  })

  // Entry points that keep the poller alive after a hot reload.
  on('ui.press', ($, e, next) => {
    ensurePoller($)
    return next(e)
  })
}
