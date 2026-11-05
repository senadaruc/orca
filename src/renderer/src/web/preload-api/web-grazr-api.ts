import { translate } from '@/i18n/i18n'
import type { PreloadApi } from '../../../../preload/api-types'
import type { GrazrSyncSnapshot } from '../../../../shared/grazr-sync-types'

function desktopOnlyMessage(): string {
  return translate(
    'grazr.web.desktopOnly',
    'Grazr runs in the desktop app on the computer that owns the host.'
  )
}

// The sync lives in the desktop app's main process, so the web client sees it off.
const SYNC_OFF: GrazrSyncSnapshot = {
  enabled: false,
  applied: false,
  devices: [],
  status: { kind: 'off' }
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
        outcome: { kind: 'unsupported-platform' },
        engineOutdated: false,
        bundledEngineVersion: null
      }),
    refresh: rejectDesktopOnly,
    swap: rejectDesktopOnly,
    setEnabled: rejectDesktopOnly,
    setAccounts: rejectDesktopOnly,
    install: rejectDesktopOnly,
    uninstall: rejectDesktopOnly,
    deploy: rejectDesktopOnly,
    enrolCommand: () => Promise.resolve({ error: desktopOnlyMessage() }),
    drainNotices: () => Promise.resolve([]),
    syncState: () => Promise.resolve(SYNC_OFF),
    syncSetEnabled: rejectDesktopOnly,
    syncApply: rejectDesktopOnly,
    syncSetIncluded: rejectDesktopOnly,
    syncKick: () => Promise.resolve(),
    onSyncStateChanged: () => () => {}
  }
}
