// Contract of the state the DRIVER mod publishes under $.state (PluginState['driver']).
// Self-contained on purpose: no imports, so the engine can lay it beside dependants.
// Keep DriverView compatible with src/shared/view.ts PlanView (checked by mod/state.ts at compile time).

export type DriverPhase = 'discover' | 'route' | 'implement' | 'validate' | 'evolve' | 'release'
export type DriverStatus = 'not_started' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'needs_rework'
export type DriverGateName = 'route' | 'release'

export type DriverPaths = {
  root: string
  driverDir: string
  planExists: boolean
}

export type DriverIssue = {
  level: string
  code: string
  path: string
  message: string
}

export type DriverLoad =
  | { kind: 'none' }
  | { kind: 'ok'; rev: number }
  | { kind: 'invalid'; issues: DriverIssue[]; lastGoodRev: number | null }
  | { kind: 'error'; message: string }

export type DriverBlockView = {
  id: string
  title: string
  phase: DriverPhase
  status: DriverStatus
  owner?: string
  reason?: string
  deps: string[]
  reqs: number
  tests: { pass: number; fail: number; unknown: number }
  verified?: boolean
  risk?: 'low' | 'medium' | 'high'
  retired: boolean
  since: string
}

export type DriverGateView = { approved: boolean; by?: string; at?: string; via?: string; ticket?: string }

export type DriverView = {
  project: string
  revision: number
  baseline: number
  currentPhase: DriverPhase
  gates: Record<DriverGateName, DriverGateView>
  blocks: DriverBlockView[]
}

export type DriverConfirm = { gate: DriverGateName; revision: number; baseline: number }

export type DriverUi = {
  focus: 'auto' | 'all' | DriverPhase
  collapseDone: boolean
  showRetired: boolean
  selected: string | null
  confirm: DriverConfirm | null
  initName: string
  exportPath: string | null
  notice: string | null
  /** ADR-015: the person switched the Implement autopilot on for this session. */
  autopilot: boolean
}

export type DriverDetail = {
  id: string
  revision: number
  doc: string
  isTruncated: boolean
}

export type DriverClaim = { block: string; at: number }

export type DriverState = {
  paths: DriverPaths | null
  load: DriverLoad
  view: DriverView | null
  ui: DriverUi
  detail: DriverDetail | null
  claims: Record<string, DriverClaim>
}

declare module 'claude-code' {
  interface PluginState {
    driver: {
      paths: DriverPaths | null
      load: DriverLoad
      view: DriverView | null
      ui: DriverUi
      detail: DriverDetail | null
      claims: Record<string, DriverClaim>
      alerts: string[]
    }
  }
}
