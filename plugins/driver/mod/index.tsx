import type { Register } from 'claude-code'

import { setConfig } from './cli.js'
import { registerAutopilot, resetAutopilot } from './autopilot.js'
import { openPane, registerCommand } from './command.js'
import { registerSpawnGuard, registerToolGuard, resetPending } from './hooks.js'
import { registerPane } from './pane.js'
import { ensurePoller, getPaths, refreshPaths, resetPoller, setOpensOnAppear, tick } from './state.js'
import { resetTickets } from './tickets.js'
import { registerToolHooks, registerTools } from './tools.js'

export const register: Register = (on, options) => {
  setConfig(options)
  resetPoller()
  resetTickets()
  resetPending()
  resetAutopilot()

  on('session.start', async ($, e, next) => {
    try {
      await registerTools($)
      await $.command.register({
        name: 'driver',
        description: 'DRIVER plan: open the pane, show status, export the diagram, init a plan, approve a gate',
        argumentHint: '[status|export|init <name>|approve <route|release>|auto <on|off>]',
      })
      const paths = (await refreshPaths($)) ?? (await getPaths($))
      // A plan created later in the session (or found once the app moves the session into the
      // real project) opens the pane too, under the same rule as below.
      setOpensOnAppear(e.surface !== 'terminal')
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
  registerAutopilot(on)
}
