import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { GrazrActionResult, GrazrHostStatus } from '../../../../shared/grazr-api-types'
import type { GrazrHostRef } from '../../../../shared/grazr-host'

// Why: a call that finishes inside this window never flashes a spinner.
const SPINNER_DELAY_MS = 200

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useGrazrHostStatus(
  host: GrazrHostRef,
  { pollMs, label }: { pollMs: number; label: string }
): {
  status: GrazrHostStatus | null
  loading: boolean
  busy: boolean
  spinning: boolean
  run: (action: () => Promise<GrazrActionResult>) => Promise<GrazrActionResult | null>
  refresh: () => Promise<void>
  asOf: number | null
} {
  const [status, setStatus] = useState<GrazrHostStatus | null>(null)
  const [loading, setLoading] = useState(true)
  // Why: busy is set at once so a double click cannot double-submit; spinning only lags it.
  const [busy, setBusy] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [asOf, setAsOf] = useState<number | null>(null)
  const busyRef = useRef(false)
  const labelRef = useRef(label)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.grazr.status(host)
      labelRef.current = label || next.label
      setStatus(next)
      setAsOf(Date.now())
    } catch (error) {
      setStatus({
        host,
        label: labelRef.current,
        outcome: { kind: 'unreachable', message: messageOf(error) },
        engineOutdated: false,
        bundledEngineVersion: null
      })
      setAsOf(Date.now())
    } finally {
      setLoading(false)
    }
  }, [host, label])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(timer)
  }, [refresh, pollMs])

  const run = useCallback(
    async (action: () => Promise<GrazrActionResult>): Promise<GrazrActionResult | null> => {
      if (busyRef.current) {
        return null
      }
      busyRef.current = true
      setBusy(true)
      const spinnerTimer = setTimeout(() => setSpinning(true), SPINNER_DELAY_MS)
      try {
        const result = await action()
        if (!result.ok) {
          toast.error(result.message)
        }
        const notices = await window.api.grazr.drainNotices(host)
        const title = translate('grazr.dialog.noticeTitle', 'grazr · {{label}}', {
          label: labelRef.current || label
        })
        for (const notice of notices) {
          toast.message(title, { description: [notice.title, notice.body].join('\n') })
        }
        // An action may have changed this host's rotation: the sync looks again now, not in a minute.
        void window.api.grazr.syncKick().catch(() => undefined)
        await refresh()
        return result
      } catch (error) {
        toast.error(messageOf(error))
        return null
      } finally {
        clearTimeout(spinnerTimer)
        busyRef.current = false
        setBusy(false)
        setSpinning(false)
      }
    },
    [host, label, refresh]
  )

  return { status, loading, busy, spinning, run, refresh, asOf }
}
