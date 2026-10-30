import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const ROOT = '/proj'
export const DRIVER_DIR = '/proj/.claude/driver'
export const PLAN_FILE = `${DRIVER_DIR}/plan.json`

export const PANE = {
  plugin: 'driver',
  component: 'Pane',
  requestId: 'driver',
  props: {
    title: 'DRIVER',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 100, rows: 40, isFullscreen: true },
} as const

export interface Run {
  argv: readonly string[]
  stdin?: string
  cwd?: string
}

export interface CliReply {
  exitCode?: number
  stdout?: string
  stderr?: string
}

export interface Agent {
  id: string
  status: 'running' | 'idle' | 'completed'
}

/** Stand-ins for everything beneath the mod: file system, processes, panes, agents. */
export interface World {
  files: Map<string, string>
  writes: { path: string; text: string }[]
  runs: Run[]
  reads: string[]
  /** Runs before the CLI stand-in: a string rejects the process.run with that message. */
  exec?: (argv: readonly string[]) => CliReply | string | undefined
  toasts: string[]
  agents: Agent[]
  /** Answers the CLI: gets argv after `node cli.js`, returns the process result. */
  cli: (args: string[], stdin?: string) => CliReply
  /** The `node <cli>` runs only: `args` without the global flags, `full` with them. */
  cliRuns: () => { args: string[]; full: string[]; actor?: string; stdin?: string }[]
  /** Bump to make plan.json look changed to stat. */
  touch: () => void
  /** Where a path lands after symlinks; identity unless a test links something. */
  real: (path: string) => string
}

/** Drops --json, --root X, --actor X and --expect-revision N from a CLI argv. */
export function stripGlobals(full: string[]): { args: string[]; actor?: string } {
  const args: string[] = []
  let actor: string | undefined
  for (let i = 0; i < full.length; i++) {
    const a = full[i]!
    if (a === '--json') continue
    if (a === '--actor') actor = full[++i]
    else if (a === '--root' || a === '--expect-revision') i++
    else args.push(a)
  }
  return { args, ...(actor ? { actor } : {}) }
}

export function world(on: On, files: Record<string, string> = {}, store: Record<string, unknown> = { nodePath: 'node' }): World {
  let mtime = 1
  const w: World = {
    files: new Map(Object.entries(files)),
    writes: [],
    runs: [],
    reads: [],
    toasts: [],
    agents: [],
    cli: () => ({ stdout: '{}' }),
    cliRuns: () =>
      w.runs
        .filter((r) => r.argv[1]?.endsWith('/dist/cli.js'))
        .map((r) => {
          const full = r.argv.slice(2) as string[]
          const { args, actor } = stripGlobals(full)
          return { args, full, ...(actor ? { actor } : {}), ...(r.stdin !== undefined ? { stdin: r.stdin } : {}) }
        }),
    touch: () => {
      mtime++
    },
    real: (p) => p,
  }

  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    const text = w.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some((k) => k.startsWith(`${e.path}/`)) }))
  on('fs.stat', (_, e) => {
    const text = w.files.get(e.path)
    const isDir = [...w.files.keys()].some((k) => k.startsWith(`${e.path}/`))
    if (text === undefined && !isDir) return { deny: `ENOENT: ${e.path}` }
    return {
      value: {
        kind: text === undefined ? ('dir' as const) : ('file' as const),
        size: text?.length ?? 0,
        mtimeMs: mtime,
        isLink: false,
        ...(e.resolve ? { realPath: w.real(e.path) } : {}),
      },
    }
  })
  on('fs.write', (_, e) => {
    w.writes.push({ path: e.path, text: e.text })
    w.files.set(e.path, e.text)
    mtime++
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const run: Run = { argv: e.argv, ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}), ...(e.init?.cwd ? { cwd: e.init.cwd } : {}) }
    w.runs.push(run)
    const pre = w.exec?.(e.argv)
    if (typeof pre === 'string') return { deny: pre }
    const isCli = e.argv[1]?.endsWith('/dist/cli.js')
    const reply = pre ?? (isCli ? w.cli(stripGlobals(e.argv.slice(2) as string[]).args, run.stdin) : { stdout: '' })
    return {
      value: {
        exitCode: reply.exitCode ?? 0,
        stdout: reply.stdout ?? '',
        stderr: reply.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: w.agents.map((a) => ({ ...a, description: '', type: 'general-purpose' })) }))
  on('ui.panes', () => ({ value: [{ id: 'driver', title: 'DRIVER', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('command.register', () => ({ value: { command: 'driver' } }))
  on('tool.register', () => ({ value: { tool: 'registered' } }))
  mock.store(on, store)
  return w
}

/** A CLI that answers `where` and the mutations the tests exercise. */
export function whereReply(planExists = true): CliReply {
  return { stdout: JSON.stringify({ root: ROOT, driverDir: DRIVER_DIR, planExists }) }
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Parses a plan, lets the test change it, serialises it again. */
export function editPlan(text: string, fn: (plan: Json) => void): string {
  const plan = JSON.parse(text) as Json
  fn(plan)
  return JSON.stringify(plan)
}

/** A valid-enough plan with `n` blocks, nearly all done, to exercise the SVG budget. */
export function bigPlan(n: number): string {
  const blocks: Record<string, unknown> = {}
  const id = (i: number) => `B-${String(i).padStart(3, '0')}`
  for (let i = 1; i <= n; i++) {
    const phase = i <= 5 ? 'discover' : i <= 10 ? 'route' : 'implement'
    blocks[id(i)] = {
      title: `Block number ${i} with a reasonably long title to fill the card`,
      phase,
      status: i < n - 5 ? 'done' : 'not_started',
      statusSince: '2026-10-20T10:00:00Z',
      statusBy: { kind: 'model', id: 'main' },
      // long tooltips push the diagram over the budget
      statusReason: 'because '.repeat(40),
      dependsOn: i > 11 && i % 3 === 0 ? [id(i - 1)] : [],
      requirements: ['R-001'],
      tests: [{ ref: 't', layer: 'unit', result: 'pass' }],
    }
  }
  return JSON.stringify({
    schemaVersion: 1,
    project: { name: 'big' },
    revision: 7,
    baseline: 1,
    currentPhase: 'implement',
    gates: { route: { approved: true, approvedBy: 'diogo', approvedAt: '2026-10-21T10:00:00Z', atBaseline: 1 }, release: { approved: false } },
    requirements: { 'R-001': { title: 'req' } },
    blocks,
  })
}
