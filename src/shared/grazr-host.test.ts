import { describe, expect, it } from 'vitest'
import { toSshExecutionHostId, UNRESOLVED_OWNER_HOST_ID } from './execution-host'
import { GrazrHostRefSchema, grazrHostKey, grazrHostRefFromExecutionHostId } from './grazr-host'

describe('grazrHostRefFromExecutionHostId', () => {
  it('maps this machine, an SSH target, and a runtime environment', () => {
    expect(grazrHostRefFromExecutionHostId('local')).toEqual({ kind: 'local' })
    expect(grazrHostRefFromExecutionHostId(toSshExecutionHostId('cloud dev'))).toEqual({
      kind: 'ssh',
      sshTargetId: 'cloud dev'
    })
    expect(grazrHostRefFromExecutionHostId('runtime:env-1')).toEqual({
      kind: 'environment',
      environmentId: 'env-1'
    })
  })

  it('answers null for the unresolved-owner bookkeeping host, which must never be dialed', () => {
    expect(grazrHostRefFromExecutionHostId(UNRESOLVED_OWNER_HOST_ID)).toBeNull()
  })
})

describe('grazrHostKey', () => {
  it('spells each host kind as a stable key', () => {
    expect(grazrHostKey({ kind: 'local' })).toBe('local')
    expect(grazrHostKey({ kind: 'environment', environmentId: 'env-1' })).toBe('env:env-1')
    expect(grazrHostKey({ kind: 'ssh', sshTargetId: 't1' })).toBe('ssh:t1')
  })
})

describe('GrazrHostRefSchema', () => {
  it('rejects an unknown kind and an environment without an id', () => {
    expect(GrazrHostRefSchema.safeParse({ kind: 'other' }).success).toBe(false)
    expect(GrazrHostRefSchema.safeParse({ kind: 'environment' }).success).toBe(false)
    expect(GrazrHostRefSchema.safeParse({ kind: 'ssh', sshTargetId: 't1' }).success).toBe(true)
  })
})
