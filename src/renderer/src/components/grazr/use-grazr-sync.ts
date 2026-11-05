import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { GrazrSyncSnapshot } from '../../../../shared/grazr-sync-types'

const OFF: GrazrSyncSnapshot = {
  enabled: false,
  applied: false,
  devices: [],
  status: { kind: 'off' }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The account sync as the main process keeps it, and the dialog's actions on it. */
export function useGrazrSync(): {
  sync: GrazrSyncSnapshot
  setEnabled: (on: boolean) => void
  apply: () => void
  setIncluded: (deviceKey: string, on: boolean) => void
} {
  const [sync, setSync] = useState<GrazrSyncSnapshot>(OFF)

  useEffect(() => {
    let live = true
    void window.api.grazr
      .syncState()
      .then((snapshot) => {
        if (live) {
          setSync(snapshot)
        }
      })
      .catch(() => undefined)
    const unsubscribe = window.api.grazr.onSyncStateChanged((snapshot) => {
      if (live) {
        setSync(snapshot)
      }
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const act = useCallback((action: () => Promise<GrazrSyncSnapshot>) => {
    action().then(setSync, (error: unknown) => toast.error(messageOf(error)))
  }, [])

  return {
    sync,
    setEnabled: (on) => act(() => window.api.grazr.syncSetEnabled(on)),
    apply: () => act(() => window.api.grazr.syncApply()),
    setIncluded: (deviceKey, on) => act(() => window.api.grazr.syncSetIncluded(deviceKey, on))
  }
}
