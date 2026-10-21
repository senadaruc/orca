import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { GrazrHostRef } from '../../shared/grazr-host'

export const grazrApi = {
  status: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:status', { host }),
  refresh: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:refresh', { host }),
  swap: (host: GrazrHostRef, name?: string) => ipcRenderer.invoke('grazr:swap', { host, name }),
  setEnabled: (host: GrazrHostRef, enabled: boolean) =>
    ipcRenderer.invoke('grazr:setEnabled', { host, enabled }),
  install: (host: GrazrHostRef, force: boolean) =>
    ipcRenderer.invoke('grazr:install', { host, force }),
  uninstall: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:uninstall', { host }),
  deploy: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:deploy', { host }),
  enrolCommand: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:enrolCommand', { host }),
  drainNotices: (host: GrazrHostRef) => ipcRenderer.invoke('grazr:drainNotices', { host })
} satisfies PreloadApi['grazr']
