import type { DriverGateName } from '../types'
import { runCli, type Dollar } from './cli.js'
import { forceTick, getPaths, readPlanFresh } from './state.js'
import { recordIssued } from './tickets.js'

const TICKET_TTL_MS = 15000
const NAME_KEY = 'userName'

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

interface Secret {
  nonce: string
  sha256: string
}

/** 32 random bytes and their sha256, from the environment's crypto or, failing that, openssl. */
async function makeSecret($: Dollar): Promise<Secret> {
  // `crypto` may be undeclared in some environments, so it is only ever reached through globalThis
  const c = (globalThis as { crypto?: typeof crypto }).crypto
  if (typeof c?.getRandomValues === 'function' && typeof c.subtle?.digest === 'function') {
    const nonce = hex(c.getRandomValues(new Uint8Array(32)))
    const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
    return { nonce, sha256: hex(new Uint8Array(digest)) }
  }
  const rand = await $.process.run(['openssl', 'rand', '-hex', '32'], { timeoutMs: 10000 })
  const nonce = rand.stdout.trim()
  if (rand.exitCode !== 0 || !/^[0-9a-f]{64}$/.test(nonce)) throw new Error('could not generate an approval code (openssl rand failed)')
  const dgst = await $.process.run(['openssl', 'dgst', '-sha256'], { stdin: nonce, timeoutMs: 10000 })
  const sha256 = /[0-9a-f]{64}/i.exec(dgst.stdout)?.[0]?.toLowerCase()
  if (dgst.exitCode !== 0 || !sha256) throw new Error('could not hash the approval code (openssl dgst failed)')
  return { nonce, sha256 }
}

/** The git identity of the person, cached; the CLI records it as the approving user. */
async function userName($: Dollar): Promise<string> {
  const cached = await $.store.get(NAME_KEY)
  if (typeof cached === 'string' && cached) return cached
  let name = ''
  try {
    const r = await $.process.run(['git', 'config', 'user.name'], { timeoutMs: 5000 })
    if (r.exitCode === 0) name = r.stdout.trim()
  } catch {
    // no git
  }
  const value = name || 'user'
  if (name) await $.store.set(NAME_KEY, name)
  return value
}

export interface ApproveResult {
  ok: boolean
  message: string
  revision?: number
  /** The revision the person approved against. */
  seenRevision?: number
}

/**
 * Approves a gate on behalf of the person. Callers must be person-initiated: a composer
 * `command.run` or a `ui.press`. The model can raise neither, and never reaches this function
 * from a tool call. `expectRevision` is the revision the person was shown.
 */
export async function approveViaMod($: Dollar, gate: DriverGateName, expectRevision?: number): Promise<ApproveResult> {
  const paths = await getPaths($)
  if (!paths) return { ok: false, message: 'DRIVER: project root is unknown' }
  const read = await readPlanFresh($, paths.driverDir)
  if (read.kind === 'missing') return { ok: false, message: 'DRIVER: no plan here' }
  if (read.kind === 'bad') return { ok: false, message: `DRIVER: ${read.message}` }
  const revision = read.plan.revision
  if (expectRevision !== undefined && expectRevision !== revision)
    return { ok: false, message: `The plan changed (revision ${expectRevision} -> ${revision}); review it and approve again.` }
  if (read.plan.gates[gate].approved) return { ok: false, message: `Gate ${gate} is already approved.` }

  const ticketFile = `${paths.driverDir}/.mod/ticket.json`
  let secret: Secret
  try {
    secret = await makeSecret($)
    const now = await $.clock.now()
    await recordIssued($, secret.sha256)
    await $.fs.write(ticketFile, JSON.stringify({ gate, revision, sha256: secret.sha256, iat: now, exp: now + TICKET_TTL_MS }))
  } catch (e) {
    return { ok: false, message: `DRIVER: approval failed: ${(e as Error).message}` }
  }
  const name = await userName($)
  const r = await runCli($, ['gate', 'approve', gate, '--via-mod', '--actor', `user:${name}`], { stdin: secret.nonce })
  if (!r.ok) {
    // The CLI consumes the ticket first; if it never ran, void it.
    if (r.isUnavailable) await $.fs.write(ticketFile, '{}').catch(() => undefined)
    return { ok: false, message: `DRIVER refused: ${r.error}` }
  }
  await forceTick($)
  const newRev = (r.json as { revision?: number } | undefined)?.revision
  return { ok: true, message: `Approved gate ${gate} at revision ${revision}.`, seenRevision: revision, ...(typeof newRev === 'number' ? { revision: newRev } : {}) }
}
