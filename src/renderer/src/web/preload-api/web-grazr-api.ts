import type { PreloadApi } from '../../../../preload/api-types'

const DESKTOP_ONLY = 'Grazr runs in the desktop app on the computer that owns the host.'

function rejectDesktopOnly(): Promise<never> {
  return Promise.reject(new Error(DESKTOP_ONLY))
}

// Why: the web client cannot reach the host's engine, so reads report the platform and writes are refused.
export function createGrazrApi(): PreloadApi['grazr'] {
  return {
    status: (host) =>
      Promise.resolve({ host, label: 'This host', outcome: { kind: 'unsupported-platform' } }),
    refresh: rejectDesktopOnly,
    swap: rejectDesktopOnly,
    setEnabled: rejectDesktopOnly,
    install: rejectDesktopOnly,
    uninstall: rejectDesktopOnly,
    deploy: rejectDesktopOnly,
    enrolCommand: () => Promise.resolve({ error: DESKTOP_ONLY }),
    drainNotices: () => Promise.resolve([])
  }
}
