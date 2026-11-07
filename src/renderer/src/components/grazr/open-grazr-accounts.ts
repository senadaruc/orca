import { useAppStore } from '@/store'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { GrazrHostRef } from '../../../../shared/grazr-host'
import type { RemoteUsageOwner } from '../status-bar/use-owner-usage-rate-limits'
import { grazrEnrolWorktreeId } from './grazr-enrol-worktree'

export function openGrazrAccountsForUsageOwner(remoteOwner: RemoteUsageOwner | null): void {
  const state = useAppStore.getState()
  // Why: a remote owner's rotation lives on that host; the local one is the bar's own machine.
  const host: GrazrHostRef = remoteOwner
    ? { kind: 'environment', environmentId: remoteOwner.environmentId }
    : { kind: 'local' }
  state.openModal('grazr-accounts', {
    host,
    label: remoteOwner?.label ?? getLocalExecutionHostLabel(),
    worktreeId: grazrEnrolWorktreeId(state, state.activeWorktreeId ?? null, host)
  })
}
