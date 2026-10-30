import type { Elements } from 'claude-code'

import { renderSvgWithinBudget } from '../src/shared/svg.js'
import type { DriverUi, DriverView } from '../types'

export type SvgKit = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg'>

/** The remote surfaces report the pane in cells of their code font; this is that font's advance, in CSS pixels. */
export const PX_PER_COLUMN = 8

/** The drawing's width: the pane's body less a small margin, never under 320px. */
export function diagramWidth(bodyColumns: number): number {
  return Math.max(320, bodyColumns * PX_PER_COLUMN - 8)
}

const DEGRADED_NOTE: Record<string, string> = {
  collapsed: 'done blocks folded to keep the drawing within budget',
  'short-tooltips': 'tooltips shortened to keep the drawing within budget',
}

export interface Diagram {
  node: ReturnType<SvgKit['Box']>
  /** The blocks drawn, for the picker beside the drawing (presses on the SVG never reach the plugin). */
  blockIds: string[]
}

/**
 * The vertical SVG at the pane's width, drawn 1:1 with hover and tooltips.
 * Null when even the folded drawing is over the markup budget; the caller falls back to the board.
 */
export function diagramView(kit: SvgKit, view: DriverView, ui: DriverUi, bodyColumns: number): Diagram | null {
  const { Box, Text, Svg } = kit
  const widthPx = diagramWidth(bodyColumns)
  const r = renderSvgWithinBudget(view, {
    bodyColumns,
    widthPx,
    orientation: 'vertical',
    focus: ui.focus,
    collapseDone: ui.collapseDone,
    showRetired: ui.showRetired,
    ...(ui.selected ? { selected: ui.selected } : {}),
  })
  if (r.degraded === 'too-large') return null
  const note = DEGRADED_NOTE[r.degraded]
  const node = (
    <Box flexDirection="column">
      <Svg key="diagram" source={r.source} alt={r.alt} width={widthPx} height={r.height} isInteractive />
      {note ? (
        <Text size="caption" dimColor>
          {note}
        </Text>
      ) : null}
    </Box>
  )
  return { node, blockIds: r.blockIds }
}
