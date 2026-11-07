import { getRuntimeSshAccess } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import type { GrazrHostRef } from '../../shared/grazr-host'
import type { ListRuntimeEnvironments } from '../ipc/shell-editor-ssh-host'

export type GrazrResolvedHost =
  | { kind: 'local' }
  | { kind: 'ssh'; sshTargetId: string; label: string }
  | { kind: 'no-ssh-access'; label: string }
  | { kind: 'unsupported-platform' }

export type GrazrResolverDeps = {
  listEnvironments: ListRuntimeEnvironments
  getConnection: (sshTargetId: string) => { getState(): { status: string } } | undefined
  platform: NodeJS.Platform
}

export function resolveGrazrHost(ref: GrazrHostRef, deps: GrazrResolverDeps): GrazrResolvedHost {
  switch (ref.kind) {
    case 'local':
      return deps.platform === 'win32' ? { kind: 'unsupported-platform' } : { kind: 'local' }
    case 'ssh':
      return sshHost(ref.sshTargetId, ref.sshTargetId, deps)
    case 'environment': {
      const environment = deps.listEnvironments().find((entry) => entry.id === ref.environmentId)
      if (!environment) {
        return { kind: 'no-ssh-access', label: ref.environmentId }
      }
      const link = getRuntimeSshAccess(environment)
      if (!link) {
        return { kind: 'no-ssh-access', label: environment.name }
      }
      return sshHost(link.sshTargetId, environment.name, deps)
    }
  }
}

// Why: a link alone is not access; the SSH connection must be up for the engine to run.
function sshHost(
  sshTargetId: string,
  label: string,
  deps: Pick<GrazrResolverDeps, 'getConnection'>
): GrazrResolvedHost {
  return deps.getConnection(sshTargetId)?.getState().status === 'connected'
    ? { kind: 'ssh', sshTargetId, label }
    : { kind: 'no-ssh-access', label }
}
