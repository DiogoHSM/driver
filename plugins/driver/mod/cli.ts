import type { EngineInterface } from 'claude-code'

export type Dollar = EngineInterface

export interface CliOptions {
  stdin?: string
  /** `kind:id` for --actor; default is the CLI's own (model:main). */
  actor?: string
  expectRevision?: number
  timeoutMs?: number
  /** Skip --root (before the paths are known). */
  noRoot?: boolean
}

export interface CliResult {
  ok: boolean
  exitCode: number
  json: unknown
  stdout: string
  stderr: string
  /** The CLI's own refusal text when it exited non-zero. */
  error: string
  /** The CLI could not run at all (no node, timeout, spawn failure). */
  isUnavailable: boolean
}

export interface ModConfig {
  nodePath: string
}

let config: ModConfig = { nodePath: '' }

export function setConfig(options: Readonly<Record<string, unknown>>): void {
  config = { nodePath: typeof options.nodePath === 'string' ? options.nodePath.trim() : '' }
}

const NODE_KEY = 'nodePath'
const PATHS = { plugin: 'driver', key: 'paths' } as const

async function discoverNode($: Dollar): Promise<string> {
  try {
    await $.process.run(['node', '--version'], { timeoutMs: 5000 })
    return 'node'
  } catch {
    // The GUI app's PATH often lacks node; ask a login shell.
    const r = await $.process.run(['/bin/zsh', '-lc', 'command -v node'], { timeoutMs: 10000 })
    const found = r.stdout.trim().split('\n').pop()?.trim() ?? ''
    if (r.exitCode !== 0 || !found.startsWith('/')) throw new Error('node was not found on PATH or in a login shell')
    return found
  }
}

/** The node binary to run the CLI with: userConfig, then the cached discovery, then a fresh one. */
export async function resolveNode($: Dollar, refresh = false): Promise<string> {
  if (config.nodePath) return config.nodePath
  if (!refresh) {
    const cached = await $.store.get(NODE_KEY)
    if (typeof cached === 'string' && cached) return cached
  }
  const found = await discoverNode($)
  await $.store.set(NODE_KEY, found)
  return found
}

/** Read-only commands: running one twice is harmless, so a stale node path may be retried. */
const RETRYABLE = new Set(['where', 'status', 'validate', 'export'])

export function cliPath($: Dollar): string {
  return `${$.plugin.root}/dist/cli.js`
}

/** Pulls the CLI's refusal text out of --json output (stdout first, then stderr). */
export function errorText(stdout: string, stderr: string): string {
  for (const s of [stdout, stderr]) {
    for (const line of s.split('\n').reverse()) {
      const t = line.trim()
      if (!t.startsWith('{')) continue
      try {
        const j = JSON.parse(t) as { error?: unknown }
        if (typeof j.error === 'string' && j.error) return j.error
      } catch {
        // not JSON
      }
    }
  }
  const plain = stderr.trim() || stdout.trim()
  return plain.replace(/^driver:\s*/, '') || 'no message'
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim())
  } catch {
    return undefined
  }
}

/** The project root `where` found, kept in $.state (not $.store: that one is shared by every project). */
async function root($: Dollar): Promise<string | undefined> {
  const { value } = await $.state.get(PATHS)
  return value?.root || undefined
}

function buildArgv(node: string, cli: string, args: readonly string[], o: CliOptions, rootDir: string | undefined): string[] {
  const argv = [node, cli, '--json']
  if (rootDir && !o.noRoot) argv.push('--root', rootDir)
  if (o.actor) argv.push('--actor', o.actor)
  if (o.expectRevision !== undefined) argv.push('--expect-revision', String(o.expectRevision))
  return [...argv, ...args]
}

/** Runs `node dist/cli.js --json ...`. Never rejects: failures come back as `ok: false`. */
export async function runCli($: Dollar, args: readonly string[], o: CliOptions = {}): Promise<CliResult> {
  const unavailable = (why: string): CliResult => ({
    ok: false,
    exitCode: -1,
    json: undefined,
    stdout: '',
    stderr: '',
    error: why,
    isUnavailable: true,
  })
  const init = { timeoutMs: o.timeoutMs ?? 15000, ...(o.stdin !== undefined ? { stdin: o.stdin } : {}) }
  const rootDir = await root($)
  const attempt = async (refresh: boolean) => {
    const node = await resolveNode($, refresh)
    return $.process.run(buildArgv(node, cliPath($), args, o, rootDir), init)
  }
  let r
  try {
    r = await attempt(false)
  } catch (first) {
    // A timed-out child may have run: never run it again. A stale cached node path is
    // rediscovered once, for read-only commands only.
    const message = (first as Error).message
    if (/time(d)? ?out/i.test(message)) return unavailable(message)
    if (!RETRYABLE.has(args[0] ?? '')) {
      await $.store.delete(NODE_KEY).catch(() => undefined)
      return unavailable(`${message}; try again`)
    }
    try {
      r = await attempt(true)
    } catch (second) {
      return unavailable(`${(second as Error).message || (first as Error).message}`)
    }
  }
  return {
    ok: r.exitCode === 0,
    exitCode: r.exitCode,
    json: parseJson(r.stdout),
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.exitCode === 0 ? '' : errorText(r.stdout, r.stderr),
    isUnavailable: false,
  }
}

/** Model-facing refusal text, per the tool contract. */
export function refusal(r: CliResult): string {
  return r.isUnavailable
    ? `DRIVER CLI unavailable: ${r.error}; fall back to the driver CLI via Bash`
    : `DRIVER refused: ${r.error}`
}
