import type { Elements } from 'claude-code'

import type { BlockStatus, PhaseId } from '../src/shared/phases.js'
import { STATUS_GLYPH } from '../src/shared/phases.js'
import { depsText, type Row } from '../src/shared/rows.js'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown'>

export interface RowHandlers {
  select: (id: string) => void
  expandDone: () => void
  expandPhase: (phase: PhaseId) => void
  selected: string | null
}

const STATUS_COLOR: Record<BlockStatus, string> = {
  not_started: 'inactive',
  in_progress: 'suggestion',
  blocked: 'error',
  in_review: 'warning',
  done: 'success',
  needs_rework: 'claude',
}

const owner = (o: string) => (o === 'main' ? 'main' : o.slice(0, 6))

/** The one block list, on every surface: phase headers, gate lines, one Button per block. */
export function rowsView(kit: Kit, rows: Row[], handlers: RowHandlers, isDim = false) {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        if (row.kind === 'phase') {
          const head = (
            <Text bold={row.current || row.reopened} color={row.current || row.reopened ? 'permission' : undefined} dimColor={isDim || (!row.open && !row.current && !row.reopened)}>
              {row.text}
            </Text>
          )
          return row.expandable ? (
            <Button key={`p${i}`} plain onPress={() => handlers.expandPhase(row.phase)}>
              {head}
            </Button>
          ) : (
            <Box key={`p${i}`}>{head}</Box>
          )
        }
        if (row.kind === 'gate')
          return (
            <Text key={`g${i}`} color={row.approved ? 'success' : 'warning'} dimColor={isDim}>
              {row.text}
            </Text>
          )
        if (row.kind === 'more')
          return (
            <Text key={`m${i}`} dimColor>
              {row.text}
            </Text>
          )
        if (row.kind === 'agg')
          return (
            <Button key={`done:${row.phase}`} plain dimColor onPress={() => handlers.expandDone()}>
              {`  ${row.text}`}
            </Button>
          )
        const sel = row.id === handlers.selected
        const flag = row.status === 'blocked' || row.status === 'needs_rework'
        return (
          <Button key={row.id} plain dimColor={isDim} onPress={() => handlers.select(row.id)}>
            <Text bold={sel} inverse={sel} dimColor={row.retired}>
              {'  '.repeat(row.depth + 1)}
              <Text color={STATUS_COLOR[row.status]}>{STATUS_GLYPH[row.status]}</Text>
              {` ${row.id}  `}
              <Text strikethrough={row.retired}>{`${row.retired ? '(retired) ' : ''}${row.title}`}</Text>
              {row.owner ? <Text dimColor>{`  ${owner(row.owner)}`}</Text> : null}
              {row.unmet.length ? <Text dimColor>{depsText(row.unmet)}</Text> : null}
              {flag ? <Text color="error" bold>{' !'}</Text> : null}
              {row.risk === 'high' ? <Text color="warning">{' ▲'}</Text> : null}
              {row.afterBaseline ? <Text color="permission">{' +'}</Text> : null}
            </Text>
          </Button>
        )
      })}
    </Box>
  )
}
