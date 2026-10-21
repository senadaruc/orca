import type { GrazrHostRef } from './grazr-host'
import type { GrazrStatusReport } from './grazr-status-report'

export type GrazrHostOutcome =
  | { kind: 'ok'; report: GrazrStatusReport; fetchedAt: number }
  | { kind: 'not-deployed' }
  | { kind: 'no-ssh-access' }
  | { kind: 'unsupported-platform' }
  | { kind: 'engine-error'; message: string }
  | { kind: 'unreachable'; message: string }

export type GrazrHostStatus = {
  host: GrazrHostRef
  label: string
  outcome: GrazrHostOutcome
}

export type GrazrActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; foreignOwner?: boolean }

export type GrazrNotice = {
  ts: string
  title: string
  body: string
}
