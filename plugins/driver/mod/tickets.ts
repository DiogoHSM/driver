import type { Dollar } from './cli.js'

const KEY = 'issuedTickets'
const CAP = 50

// Memory covers the session; $.store covers a hot reload. Both hold only hashes.
let issued: string[] = []

export function resetTickets(): void {
  issued = []
}

export async function recordIssued($: Dollar, sha256: string): Promise<void> {
  issued = [...issued, sha256].slice(-CAP)
  const stored = await $.store.get(KEY)
  const old = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  await $.store.set(KEY, [...old, sha256].slice(-CAP))
}

export async function wasIssued($: Dollar, sha256: string): Promise<boolean> {
  if (issued.includes(sha256)) return true
  const stored = await $.store.get(KEY)
  return Array.isArray(stored) && stored.includes(sha256)
}
