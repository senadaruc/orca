import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import { useAppStore } from '../../store'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { RemoteUsageOwner } from '../status-bar/use-owner-usage-rate-limits'
import {
  grazrHostKey,
  grazrHostRefFromExecutionHostId,
  type GrazrHostRef
} from '../../../../shared/grazr-host'

// Why: the login terminal runs on the worktree's host, so a worktree on another host would enrol the wrong machine.
export function grazrEnrolWorktreeId(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string | null,
  host: GrazrHostRef
): string | null {
  if (worktreeId === null) {
    return null
  }
  const worktreeHost = grazrHostRefFromExecutionHostId(
    getExecutionHostIdForWorktree(state, worktreeId)
  )
  return worktreeHost !== null && grazrHostKey(worktreeHost) === grazrHostKey(host)
    ? worktreeId
    : null
}

// Why: a remote owner's rotation lives on that host; the local one is the bar's own machine.
export function openGrazrAccountsForUsageOwner(remoteOwner: RemoteUsageOwner | null): void {
  const state = useAppStore.getState()
  const host: GrazrHostRef = remoteOwner
    ? { kind: 'environment', environmentId: remoteOwner.environmentId }
    : { kind: 'local' }
  state.openModal('grazr-accounts', {
    host,
    label: remoteOwner?.label ?? getLocalExecutionHostLabel(),
    worktreeId: grazrEnrolWorktreeId(state, state.activeWorktreeId ?? null, host)
  })
}
