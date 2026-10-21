import { describe, expect, it } from 'vitest'
import type { GrazrHostRef } from '../../shared/grazr-host'
import { resolveGrazrHost, type GrazrResolverDeps } from './grazr-host-resolver'

const SSH_LINK = {
  sshTargetId: 'target-1',
  sshTargetGeneration: 1,
  localPort: 2222,
  remotePort: 22,
  endpointId: 'endpoint-1',
  previousPreferredEndpointId: 'endpoint-0'
}

function deps(overrides: Partial<GrazrResolverDeps> = {}): GrazrResolverDeps {
  return {
    listEnvironments: () => [],
    getConnection: () => undefined,
    platform: 'darwin',
    ...overrides
  }
}

describe('resolveGrazrHost', () => {
  it('resolves the local computer on darwin', () => {
    const ref: GrazrHostRef = { kind: 'local' }
    expect(resolveGrazrHost(ref, deps())).toEqual({ kind: 'local' })
  })

  it('reports local as unsupported on win32', () => {
    const ref: GrazrHostRef = { kind: 'local' }
    expect(resolveGrazrHost(ref, deps({ platform: 'win32' }))).toEqual({
      kind: 'unsupported-platform'
    })
  })

  it('labels a connected environment with its name', () => {
    const ref: GrazrHostRef = { kind: 'environment', environmentId: 'env-1' }
    const resolved = resolveGrazrHost(
      ref,
      deps({
        listEnvironments: () => [{ id: 'env-1', name: 'Build box', sshAccess: SSH_LINK }],
        getConnection: (id) =>
          id === 'target-1' ? { getState: () => ({ status: 'connected' }) } : undefined
      })
    )
    expect(resolved).toEqual({ kind: 'ssh', sshTargetId: 'target-1', label: 'Build box' })
  })

  it('reports no SSH access when the connection is missing', () => {
    const ref: GrazrHostRef = { kind: 'environment', environmentId: 'env-1' }
    const resolved = resolveGrazrHost(
      ref,
      deps({ listEnvironments: () => [{ id: 'env-1', name: 'Build box', sshAccess: SSH_LINK }] })
    )
    expect(resolved).toEqual({ kind: 'no-ssh-access', label: 'Build box' })
  })

  it('reports no SSH access while the connection is still connecting', () => {
    const ref: GrazrHostRef = { kind: 'environment', environmentId: 'env-1' }
    const resolved = resolveGrazrHost(
      ref,
      deps({
        listEnvironments: () => [{ id: 'env-1', name: 'Build box', sshAccess: SSH_LINK }],
        getConnection: () => ({ getState: () => ({ status: 'connecting' }) })
      })
    )
    expect(resolved).toEqual({ kind: 'no-ssh-access', label: 'Build box' })
  })

  it('reports no SSH access for an environment that is not known', () => {
    const ref: GrazrHostRef = { kind: 'environment', environmentId: 'env-missing' }
    expect(resolveGrazrHost(ref, deps())).toEqual({
      kind: 'no-ssh-access',
      label: 'env-missing'
    })
  })

  it('resolves an SSH host to its target when the connection is up', () => {
    const ref: GrazrHostRef = { kind: 'ssh', sshTargetId: 'target-2' }
    expect(
      resolveGrazrHost(
        ref,
        deps({ getConnection: () => ({ getState: () => ({ status: 'connected' }) }) })
      )
    ).toEqual({ kind: 'ssh', sshTargetId: 'target-2', label: 'target-2' })
  })

  it('reports no SSH access for an SSH host whose connection is down', () => {
    const ref: GrazrHostRef = { kind: 'ssh', sshTargetId: 'target-2' }
    expect(resolveGrazrHost(ref, deps())).toEqual({ kind: 'no-ssh-access', label: 'target-2' })
  })
})
