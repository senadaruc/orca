import type { GrazrHostOutcome } from './grazr-api-types'
import type { GrazrStatusReport } from './grazr-status-report'

export type GrazrHostChipKind =
  | 'on'
  | 'off'
  | 'not-connected'
  | 'foreign'
  | 'managed'
  | 'not-deployed'
  | 'unreachable'
  | 'no-ssh-access'
  | 'unsupported-platform'
  | 'engine-error'
export type GrazrHostChip = { kind: GrazrHostChipKind; label: string }

// Failures are checked first; a chip can only be one state, so a conflict outranks the on/off state.
// A host whose status line or hook is disconnected reports installed false, and nothing rotates there whatever the setting says.
export function grazrHostChip(outcome: GrazrHostOutcome): GrazrHostChip {
  switch (outcome.kind) {
    case 'not-deployed':
      return { kind: 'not-deployed', label: 'engine not installed' }
    case 'no-ssh-access':
      return { kind: 'no-ssh-access', label: 'no SSH access' }
    case 'unsupported-platform':
      return { kind: 'unsupported-platform', label: 'unsupported platform' }
    case 'unreachable':
      return { kind: 'unreachable', label: 'unreachable' }
    case 'engine-error':
      return { kind: 'engine-error', label: 'engine error' }
    case 'ok':
      return reportChip(outcome.report)
  }
}

function reportChip(report: GrazrStatusReport): GrazrHostChip {
  if (report.connection.foreign?.statusline) {
    return { kind: 'foreign', label: 'another grazr owns the status line' }
  }
  if (report.managed_profile) {
    return { kind: 'managed', label: 'managed profile' }
  }
  if (report.installed === false) {
    return { kind: 'not-connected', label: 'not connected' }
  }
  return report.settings.enabled
    ? { kind: 'on', label: 'rotation on' }
    : { kind: 'off', label: 'rotation off' }
}
