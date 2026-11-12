import type { Elements } from 'claude-code'

import type { BlockStatus, PhaseId } from '../src/shared/phases.js'
import { depsText, docSections, type Row } from '../src/shared/rows.js'
import { baselineText } from '../src/shared/view.js'
import type { DriverDetail, DriverGateName, DriverView } from '../types'

export type BoardKit = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Markdown'>

export interface BoardHandlers {
  select: (id: string) => void
  expandDone: () => void
  expandPhase: (phase: PhaseId) => void
  selected: string | null
}

export const STATUS_COLOR: Record<BlockStatus, string> = {
  not_started: 'inactive',
  in_progress: 'suggestion',
  blocked: 'error',
  in_review: 'warning',
  done: 'success',
  needs_rework: 'claude',
}

const CARD_WIDTH = 26

type PhaseRow = Extract<Row, { kind: 'phase' }>
type BlockRow = Extract<Row, { kind: 'block' }>
type Section = { head: PhaseRow; cards: Row[] }

/** Groups the flat rows into what the board draws: gate lines between sections, a header and its cards in each. */
function sections(rows: Row[]): (Section | Extract<Row, { kind: 'gate' | 'more' }>)[] {
  const out: (Section | Extract<Row, { kind: 'gate' | 'more' }>)[] = []
  let cur: Section | null = null
  for (const r of rows) {
    if (r.kind === 'phase') {
      cur = { head: r, cards: [] }
      out.push(cur)
    } else if (r.kind === 'block' || r.kind === 'agg') cur?.cards.push(r)
    else {
      cur = null
      out.push(r)
    }
  }
  return out
}

function card(kit: BoardKit, r: BlockRow, hd: BoardHandlers) {
  const { Box, Text, Button } = kit
  const sel = r.id === hd.selected
  const color = STATUS_COLOR[r.status]
  const flag = r.status === 'blocked' || r.status === 'needs_rework'
  const meta = [r.ownerLabel, r.unmet.length ? depsText(r.unmet).replace(/^ /, '') : ''].filter(Boolean).join('  ')
  // a Button holds Text only, so the card is a bordered Box around a Button; the Button is the click target
  return (
    <Box
      key={`card-${r.id}`}
      flexDirection="column"
      width={CARD_WIDTH}
      paddingX="xs"
      borderStyle={sel ? 'bold' : 'round'}
      borderColor={sel ? 'permission' : color}
      hover={{ scope: r.id, borderColor: 'permission' }}
    >
      <Button key={r.id} plain onPress={() => hd.select(r.id)}>
        <Text mono weight="semibold" dimColor={r.retired} strikethrough={r.retired}>
          {r.id}
        </Text>
        <Text size="caption" color={color}>
          {`  ${r.statusLabel}`}
        </Text>
        <Text weight={sel ? 'semibold' : 'regular'} dimColor={r.retired} strikethrough={r.retired}>
          {`\n${r.retired ? '(retired) ' : ''}${r.cardTitle}`}
        </Text>
      </Button>
      {(meta || flag || r.risk === 'high' || r.afterBaseline) && (
        <Box flexDirection="row" gap="xs">
          {meta ? (
            <Text size="caption" dimColor>
              {meta}
            </Text>
          ) : null}
          {flag ? (
            <Text size="caption" color="error" weight="semibold">
              !
            </Text>
          ) : null}
          {r.risk === 'high' ? (
            <Text size="caption" color="warning">
              ▲
            </Text>
          ) : null}
          {r.afterBaseline ? (
            <Text size="caption" color="permission" weight="semibold">
              +
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function aggCard(kit: BoardKit, r: Extract<Row, { kind: 'agg' }>, hd: BoardHandlers) {
  const { Box, Text, Button } = kit
  return (
    <Box key={`agg-${r.phase}`} width={CARD_WIDTH} paddingX="xs" borderStyle="round" borderColor="success" hover={{ scope: `done:${r.phase}`, borderColor: 'permission' }}>
      <Button key={`done:${r.phase}`} plain onPress={() => hd.expandDone()}>
        <Text color="success">{r.text}</Text>
        <Text size="caption" dimColor>
          {'  hidden, press to show'}
        </Text>
      </Button>
    </Box>
  )
}

function phaseHeader(kit: BoardKit, head: PhaseRow, hd: BoardHandlers, isDim: boolean) {
  const { Box, Text, Button } = kit
  const name = (
    <Text weight="semibold" color={head.current || head.reopened ? 'permission' : undefined} dimColor={isDim || (!head.open && !head.current && !head.reopened)}>
      {`${head.open ? '▾' : '▸'} ${head.phase.toUpperCase()}`}
    </Text>
  )
  const count = (
    <Text size="caption" dimColor>
      {head.total === 0 ? '  no blocks' : `  ${head.done}/${head.total} done`}
    </Text>
  )
  const current = head.current ? (
    <Text size="caption" color="permission">
      {'  ● current'}
    </Text>
  ) : null
  const reopened = head.reopened ? (
    <Text size="caption" color="permission">
      {'  ↺ reopened'}
    </Text>
  ) : null
  const attention =
    !head.open && head.attention ? (
      <Text size="caption" color="error">
        {`  ! ${head.attention}`}
      </Text>
    ) : null
  return head.expandable ? (
    <Button key={`h-${head.phase}`} plain onPress={() => hd.expandPhase(head.phase)}>
      {name}
      {count}
      {current}
      {reopened}
      {attention}
    </Button>
  ) : (
    <Box key={`h-${head.phase}`} flexDirection="row">
      {name}
      {count}
      {current}
      {reopened}
      {attention}
    </Box>
  )
}

/** The board: a header per phase, its blocks as cards, a line for each gate. */
export function boardView(kit: BoardKit, rows: Row[], hd: BoardHandlers, isDim = false) {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column">
      {sections(rows).map((sec, i) => {
        if ('head' in sec)
          return (
            <Box key={`s${i}`} flexDirection="column" marginBottom="sm">
              {phaseHeader(kit, sec.head, hd, isDim)}
              {sec.head.open && sec.cards.length > 0 ? (
                <Box flexDirection="row" flexWrap="wrap" gap="sm" paddingTop="xs">
                  {sec.cards.map((c) => (c.kind === 'agg' ? aggCard(kit, c, hd) : c.kind === 'block' ? card(kit, c, hd) : null))}
                </Box>
              ) : null}
            </Box>
          )
        if (sec.kind === 'gate')
          return (
            <Box key={`g${i}`} marginBottom="sm" justifyContent="center" borderStyle="round" borderColor={sec.approved ? 'success' : 'warning'}>
              <Text size="caption" color={sec.approved ? 'success' : 'warning'}>
                {sec.approved ? `✓ gate ${sec.gate} · approved${sec.by ? ` by ${sec.by}` : ''}` : `gate ${sec.gate} · pending`}
              </Text>
            </Box>
          )
        return (
          <Text key={`m${i}`} dimColor>
            {sec.text}
          </Text>
        )
      })}
    </Box>
  )
}

/** Project name and state on the left, the export on the right. The gates are drawn in the board itself. */
export function boardHeader(kit: BoardKit, view: DriverView, onExport: () => void) {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="column">
        <Text size="heading" weight="semibold">
          {view.project}
        </Text>
        <Text dimColor>{`phase ${view.currentPhase} · rev ${view.revision} · ${baselineText(view)}`}</Text>
      </Box>
      <Button key="export" variant="secondary" onPress={onExport}>
        Export Mermaid
      </Button>
    </Box>
  )
}

/** The selected block: title and status, a line of facts, then only the document sections that say something. */
export function boardDetail(kit: BoardKit, view: DriverView, d: DriverDetail | null, onClose: () => void) {
  const { Box, Text, Button, Markdown } = kit
  const b = d && view.blocks.find((x) => x.id === d.id)
  if (!d || !b) return null
  const facts = [
    `${b.status.replace('_', ' ')} since ${b.since}`,
    b.owner ? `owner ${b.owner}` : '',
    b.deps.length ? `depends on ${b.deps.join(', ')}` : '',
    b.waitingOn?.length ? `waiting on ${b.waitingOn.join(', ')}` : '',
    b.afterBaseline ? `added after baseline ${view.baseline}` : '',
    `${b.reqs} req, tests ${b.tests.pass} pass / ${b.tests.fail} fail / ${b.tests.unknown} unknown`,
  ].filter(Boolean)
  const parts = docSections(d.doc)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={STATUS_COLOR[b.status]} paddingX="sm" marginTop="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text weight="semibold">{`${b.id} · ${b.title}`}</Text>
        <Button key="close-detail" hotkey="x" variant="secondary" onPress={onClose}>
          x
        </Button>
      </Box>
      <Text size="caption" dimColor>
        {facts.join(' · ')}
      </Text>
      {b.reason ? <Text color="error">{`reason: ${b.reason}`}</Text> : null}
      {parts.length ? <Markdown key="detail-doc" text={parts.join('\n\n')} /> : <Text dimColor>no notes yet</Text>}
      {d.isTruncated ? (
        <Text size="caption" dimColor>
          (document cut at 6000 characters)
        </Text>
      ) : null}
    </Box>
  )
}
