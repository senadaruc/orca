import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/workspace/ownership/worktree-runtime-owner-state'
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
