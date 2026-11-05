import type { GrazrHostRef } from '../../shared/grazr-host'
import { getRuntimeSshAccess } from '../../shared/runtime-environments'
import type { SshTarget } from '../../shared/ssh-types'
import type { ListRuntimeEnvironments } from '../ipc/shell-editor-ssh-host'

/** A host the sync can read and push: this computer, an environment reached over SSH, or a
 *  registered SSH target. */
export type GrazrSyncDeviceRef = { key: string; name: string; host: GrazrHostRef }

export type GrazrSyncDeviceDeps = {
  listSshTargets: () => readonly SshTarget[]
  listEnvironments: ListRuntimeEnvironments
  platform: NodeJS.Platform
  localName: string
}

// Why: an environment and a plain SSH target can reach the same machine, so devices are keyed by
// the SSH target they resolve to and the environment, which carries the user's name for it, wins.
export function listGrazrSyncDevices(deps: GrazrSyncDeviceDeps): GrazrSyncDeviceRef[] {
  const devices = new Map<string, GrazrSyncDeviceRef>()
  if (deps.platform !== 'win32') {
    devices.set('local', { key: 'local', name: deps.localName, host: { kind: 'local' } })
  }
  for (const environment of deps.listEnvironments()) {
    const link = getRuntimeSshAccess(environment)
    if (!link) {
      continue
    }
    const key = `ssh:${link.sshTargetId}`
    if (!devices.has(key)) {
      devices.set(key, {
        key,
        name: environment.name,
        host: { kind: 'environment', environmentId: environment.id }
      })
    }
  }
  for (const target of deps.listSshTargets()) {
    const key = `ssh:${target.id}`
    // An owned target is an implementation detail of a runtime, not a machine the user named.
    if (target.owner === undefined && !devices.has(key)) {
      devices.set(key, { key, name: target.label, host: { kind: 'ssh', sshTargetId: target.id } })
    }
  }
  return [...devices.values()]
}
