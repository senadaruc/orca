import { describe, expect, it } from 'vitest'
import type { WorktreeRuntimeOwnerState } from '@/lib/workspace/ownership/worktree-runtime-owner-state'
import { grazrEnrolWorktreeId } from './grazr-enrol-worktree'

const LOCAL = { kind: 'local' } as const
const ENVIRONMENT = { kind: 'environment', environmentId: 'env-1' } as const

describe('grazrEnrolWorktreeId', () => {
  it('drops a direct-SSH worktree when the dialog is on the local host', () => {
    const state: WorktreeRuntimeOwnerState = {
      activeWorktreeId: 'wt-remote',
      activeWorkspaceExecutionHostId: 'ssh:target-1'
    }
    expect(grazrEnrolWorktreeId(state, 'wt-remote', LOCAL)).toBeNull()
  })

  it('passes a local worktree through to the local dialog', () => {
    const state: WorktreeRuntimeOwnerState = {
      activeWorktreeId: 'wt-local',
      activeWorkspaceExecutionHostId: 'local'
    }
    expect(grazrEnrolWorktreeId(state, 'wt-local', LOCAL)).toBe('wt-local')
  })

  it('passes an environment worktree through only to the same environment', () => {
    const state: WorktreeRuntimeOwnerState = {
      activeWorktreeId: 'wt-env',
      activeWorkspaceExecutionHostId: 'runtime:env-1'
    }
    expect(grazrEnrolWorktreeId(state, 'wt-env', ENVIRONMENT)).toBe('wt-env')
    expect(
      grazrEnrolWorktreeId(state, 'wt-env', { kind: 'environment', environmentId: 'env-2' })
    ).toBeNull()
    expect(grazrEnrolWorktreeId(state, 'wt-env', LOCAL)).toBeNull()
  })

  it('passes no worktree when none is active', () => {
    expect(grazrEnrolWorktreeId({}, null, LOCAL)).toBeNull()
  })
})
