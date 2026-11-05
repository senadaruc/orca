import type { GrazrHostRef } from './grazr-host'
import type { GrazrStatusReport } from './grazr-status-report'
import type { GrazrSyncSnapshot } from './grazr-sync-types'

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
  // True only when the host reports an engine version that differs from the bundled one.
  engineOutdated: boolean
  // Read only for a reachable host; null otherwise.
  bundledEngineVersion: string | null
}

export type GrazrActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; foreignOwner?: boolean }

export type GrazrNotice = {
  ts: string
  title: string
  body: string
}

export type GrazrApi = {
  status(host: GrazrHostRef): Promise<GrazrHostStatus>
  refresh(host: GrazrHostRef): Promise<GrazrActionResult>
  swap(host: GrazrHostRef, name?: string): Promise<GrazrActionResult>
  setEnabled(host: GrazrHostRef, enabled: boolean): Promise<GrazrActionResult>
  /** Writes the host's ACCOUNTS order, in that host's own account names. */
  setAccounts(host: GrazrHostRef, names: readonly string[]): Promise<GrazrActionResult>
  install(host: GrazrHostRef, force: boolean): Promise<GrazrActionResult>
  uninstall(host: GrazrHostRef): Promise<GrazrActionResult>
  deploy(host: GrazrHostRef): Promise<GrazrActionResult>
  enrolCommand(host: GrazrHostRef): Promise<{ command: string } | { error: string }>
  drainNotices(host: GrazrHostRef): Promise<GrazrNotice[]>
}

/** The account sync across this computer and the hosts Orca reaches, kept by the main process. */
export type GrazrSyncApi = {
  syncState(): Promise<GrazrSyncSnapshot>
  syncSetEnabled(enabled: boolean): Promise<GrazrSyncSnapshot>
  syncApply(): Promise<GrazrSyncSnapshot>
  syncSetIncluded(deviceKey: string, included: boolean): Promise<GrazrSyncSnapshot>
  /** One round now, after an action that may have changed a host. */
  syncKick(): Promise<void>
  onSyncStateChanged(callback: (snapshot: GrazrSyncSnapshot) => void): () => void
}
