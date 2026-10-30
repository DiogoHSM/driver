import type { Register } from 'claude-code'

import { setConfig } from './cli.js'
import { openPane, registerCommand } from './command.js'
import { registerSpawnGuard, registerToolGuard, resetPending } from './hooks.js'
import { registerPane } from './pane.js'
import { ensurePoller, getPaths, refreshPaths, resetPoller, tick } from './state.js'
import { resetTickets } from './tickets.js'
import { registerToolHooks, registerTools } from './tools.js'

export const register: Register = (on, options) => {
  setConfig(options)
  resetPoller()
  resetTickets()
  resetPending()

  on('session.start', async ($, e, next) => {
    try {
      await registerTools($)
      await $.command.register({
        name: 'driver',
        description: 'DRIVER plan: open the pane, show status, export the diagram, init a plan, approve a gate',
        argumentHint: '[status|export|init <name>|approve <route|release>]',
      })
      const paths = (await refreshPaths($)) ?? (await getPaths($))
      await tick($, true)
      ensurePoller($)
      // Never open a pane unasked on the terminal; elsewhere ui.open is harmless when no surface
      // seats panes (it resolves isPlaced: false), and a Desktop-driven session may report
      // isInteractive false or a null surface at session.start.
      if (e.surface !== 'terminal' && paths?.planExists) void openPane($).catch(() => undefined)
    } catch {
      // the hooks below keep working without the pane
    }
    return next(e)
  })

  registerPane(on)
  registerToolHooks(on)
  registerSpawnGuard(on)
  registerToolGuard(on)
  registerCommand(on)
}
