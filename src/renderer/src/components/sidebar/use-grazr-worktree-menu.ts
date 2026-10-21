import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectRuntimeAwareSshTargetLabel } from '@/store/slices/runtime-environment-ssh-selectors'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { openGrazrEnrolTerminal } from '../grazr/grazr-enrol-terminal'
import { buildGrazrRotationView, type GrazrRowStatus } from '../../../../shared/grazr-rotation-view'
import type { GrazrActionResult, GrazrHostStatus } from '../../../../shared/grazr-api-types'
import { grazrHostRefFromExecutionHostId, type GrazrHostRef } from '../../../../shared/grazr-host'
import {
  getCurrentLocalPlatform,
  getLocalExecutionHostLabel,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { GrazrStatusReport } from '../../../../shared/grazr-status-report'

export type GrazrSwitchTarget = { name: string; isNext: boolean }

// Why: a host with no POSIX shell has no engine to rotate, so its menu is hidden rather than offering dead items.
export function grazrMenuHostFor(
  hostId: ExecutionHostId,
  localPlatform: NodeJS.Platform | null
): GrazrHostRef | null {
  const host = grazrHostRefFromExecutionHostId(hostId)
  if (host?.kind === 'local' && localPlatform === 'win32') {
    return null
  }
  return host
}

// Why: an active or blocked account cannot be switched to, and an unenrolled name has nothing to switch to.
const NOT_SWITCHABLE: readonly GrazrRowStatus[] = ['active', 'blocked', 'not-enrolled']

export function grazrSwitchTargets(report: GrazrStatusReport, now: Date): GrazrSwitchTarget[] {
  return buildGrazrRotationView(report, 'session', now)
    .rows.filter((row) => !NOT_SWITCHABLE.includes(row.status))
    .map((row) => ({ name: row.name, isNext: row.isNext }))
}

export function grazrConnectionAction(installed: boolean | null): 'connect' | 'disconnect' | null {
  if (installed === null) {
    return null
  }
  return installed ? 'disconnect' : 'connect'
}

export function grazrActiveEmail(report: GrazrStatusReport, now: Date): string | null {
  const active = buildGrazrRotationView(report, 'session', now).rows.find((row) => row.isActive)
  return active ? (active.email ?? active.name) : null
}

export type GrazrLabelState = Pick<
  AppState,
  | 'sshConnectionStates'
  | 'sshTargetLabels'
  | 'removedSshTargetLabels'
  | 'sshTargetsHydrated'
  | 'sshStateByEnvironment'
> & {
  runtimeEnvironments: readonly { id: string; name: string }[]
}

export function grazrHostLabel(host: GrazrHostRef, state: GrazrLabelState): string {
  switch (host.kind) {
    case 'local':
      return getLocalExecutionHostLabel()
    case 'environment':
      return (
        state.runtimeEnvironments.find((environment) => environment.id === host.environmentId)
          ?.name || host.environmentId
      )
    case 'ssh':
      return selectRuntimeAwareSshTargetLabel(state, null, host.sshTargetId)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useGrazrWorktreeMenu(worktreeId: string): {
  host: GrazrHostRef | null
  label: string
  status: GrazrHostStatus | null
  load: () => void
  actions: {
    openAccounts: () => void
    swapTo: (name: string) => void
    swapNext: () => void
    reauthenticate: () => void
    connect: () => void
    disconnect: () => void
  }
} {
  const hostId = useAppStore((state) => getExecutionHostIdForWorktree(state, worktreeId))
  const host = useMemo(() => grazrMenuHostFor(hostId, getCurrentLocalPlatform()), [hostId])
  const label = useAppStore((state) => (host === null ? '' : grazrHostLabel(host, state)))
  const [status, setStatus] = useState<GrazrHostStatus | null>(null)
  const loadedRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchStatus = useCallback(async (): Promise<void> => {
    if (host === null) {
      return
    }
    try {
      setStatus(await window.api.grazr.status(host))
    } catch (error) {
      setStatus({
        host,
        label,
        outcome: { kind: 'unreachable', message: messageOf(error) },
        engineOutdated: false,
        bundledEngineVersion: null
      })
    }
  }, [host, label])

  // Why: the menu mounts per open, so one read per open is enough; actions re-read after they change the host.
  const load = useCallback((): void => {
    if (loadedRef.current) {
      return
    }
    loadedRef.current = true
    void fetchStatus()
  }, [fetchStatus])

  const runAction = useCallback(
    async (action: () => Promise<GrazrActionResult>): Promise<void> => {
      try {
        const result = await action()
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.message)
        }
      } catch (error) {
        toast.error(messageOf(error))
      }
      // Why: a chosen item closes the menu, so a refresh after unmount would only set state on a dead component.
      if (mountedRef.current) {
        await fetchStatus()
      }
    },
    [fetchStatus]
  )

  const actions = useMemo(
    () => ({
      openAccounts: (): void => {
        if (host === null) {
          return
        }
        useAppStore.getState().openModal('grazr-accounts', { host, label, worktreeId })
      },
      swapTo: (name: string): void => {
        if (host !== null) {
          void runAction(() => window.api.grazr.swap(host, name))
        }
      },
      swapNext: (): void => {
        if (host !== null) {
          void runAction(() => window.api.grazr.swap(host))
        }
      },
      reauthenticate: (): void => {
        if (host === null) {
          return
        }
        void (async (): Promise<void> => {
          try {
            const enrol = await window.api.grazr.enrolCommand(host)
            if ('error' in enrol) {
              toast.error(enrol.error)
              return
            }
            openGrazrEnrolTerminal({ worktreeId, command: enrol.command, label })
          } catch (error) {
            toast.error(messageOf(error))
          }
        })()
      },
      connect: (): void => {
        if (host !== null) {
          void runAction(() => window.api.grazr.install(host, false))
        }
      },
      disconnect: (): void => {
        if (host !== null) {
          void runAction(() => window.api.grazr.uninstall(host))
        }
      }
    }),
    [host, label, runAction, worktreeId]
  )

  return { host, label, status, load, actions }
}
