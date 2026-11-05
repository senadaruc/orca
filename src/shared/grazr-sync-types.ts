import type { GrazrHostRef } from './grazr-host'

// What the Claude Accounts dialog shows of the account sync, as the main process keeps it.

export type GrazrSyncTone = 'ok' | 'warning'

/** One line of the sync status. */
export type GrazrSyncLine = {
  id: string
  text: string
  tone: GrazrSyncTone
  // The device the line is about, when it is about one.
  deviceKey: string | null
  // Set when the line reports a blocked account on that device, so the dialog can offer a re-login.
  blockedAccount: string | null
}

/** A device that can take part: every host Orca can run the engine on. */
export type GrazrSyncDevice = {
  key: string
  name: string
  host: GrazrHostRef
  included: boolean
  // True once a status read found the engine installed there.
  runsGrazr: boolean
}

export type GrazrSyncStatus =
  | { kind: 'off' }
  // Fewer than two devices run grazr; `name` is the one that does.
  | { kind: 'few-devices'; name: string | null }
  // Turned on with something to move: what the first round would do, run on Apply.
  | { kind: 'preview'; lines: GrazrSyncLine[]; moves: number }
  | { kind: 'lines'; lines: GrazrSyncLine[] }

export type GrazrSyncSnapshot = {
  enabled: boolean
  applied: boolean
  devices: GrazrSyncDevice[]
  status: GrazrSyncStatus
}

export const GRAZR_SYNC_STATE_CHANGED_CHANNEL = 'grazr:syncStateChanged'
