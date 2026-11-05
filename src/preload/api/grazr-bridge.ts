import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { GrazrHostRef } from '../../shared/grazr-host'
import {
  GRAZR_SYNC_STATE_CHANGED_CHANNEL,
  type GrazrSyncSnapshot
} from '../../shared/grazr-sync-types'

export const grazrApi = {
  status: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:status', { host }),
  refresh: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:refresh', { host }),
  swap: (host: GrazrHostRef, name?: string) => ipcRenderer.invoke('grazr:swap', { host, name }),
  setEnabled: (host: GrazrHostRef, enabled: boolean) =>
    ipcRenderer.invoke('grazr:setEnabled', { host, enabled }),
  setAccounts: (host: GrazrHostRef, names: readonly string[]) =>
    ipcRenderer.invoke('grazr:setAccounts', { host, names: [...names] }),
  install: (host: GrazrHostRef, force: boolean) =>
    ipcRenderer.invoke('grazr:install', { host, force }),
  uninstall: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:uninstall', { host }),
  deploy: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:deploy', { host }),
  enrolCommand: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:enrolCommand', { host }),
  drainNotices: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:drainNotices', { host }),
  syncState: () => ipcRenderer.invoke('grazr:syncState'),
  syncSetEnabled: (enabled: boolean) => ipcRenderer.invoke('grazr:syncSetEnabled', { enabled }),
  syncApply: () => ipcRenderer.invoke('grazr:syncApply'),
  syncSetIncluded: (deviceKey: string, included: boolean) =>
    ipcRenderer.invoke('grazr:syncSetIncluded', { deviceKey, included }),
  syncKick: () => ipcRenderer.invoke('grazr:syncKick'),
  onSyncStateChanged: (callback: (snapshot: GrazrSyncSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: GrazrSyncSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(GRAZR_SYNC_STATE_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(GRAZR_SYNC_STATE_CHANGED_CHANNEL, listener)
  }
} satisfies PreloadApi['grazr']
