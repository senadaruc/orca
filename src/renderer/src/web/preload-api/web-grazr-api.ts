import { translate } from '@/i18n/i18n'
import type { PreloadApi } from '../../../../preload/api-types'

function desktopOnlyMessage(): string {
  return translate(
    'grazr.web.desktopOnly',
    'Grazr runs in the desktop app on the computer that owns the host.'
  )
}

function rejectDesktopOnly(): Promise<never> {
  return Promise.reject(new Error(desktopOnlyMessage()))
}

// Why: the web client cannot reach the host's engine, so reads report the platform and writes are refused.
export function createGrazrApi(): PreloadApi['grazr'] {
  return {
    status: (host) =>
      Promise.resolve({
        host,
        label: translate('grazr.web.hostLabel', 'This host'),
        outcome: { kind: 'unsupported-platform' }
      }),
    refresh: rejectDesktopOnly,
    swap: rejectDesktopOnly,
    setEnabled: rejectDesktopOnly,
    install: rejectDesktopOnly,
    uninstall: rejectDesktopOnly,
    deploy: rejectDesktopOnly,
    enrolCommand: () => Promise.resolve({ error: desktopOnlyMessage() }),
    drainNotices: () => Promise.resolve([])
  }
}
