import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { BrowserError } from '../../../browser/browser-error'

/** Asks the renderer, which owns Orca's tab model, to change it and waits for its answer. */
export async function requestBrowserTabRendererChange(
  win: Electron.BrowserWindow,
  channels: { request: string; reply: string },
  payload: Record<string, unknown>,
  timeoutMessage: string
): Promise<void> {
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener(channels.reply, handler)
      reject(new Error(timeoutMessage))
    }, 10_000)

    const handler = (
      event: Electron.IpcMainEvent,
      reply: { requestId: string; error?: string; code?: 'browser_tab_not_found' }
    ): void => {
      if (event.sender !== win.webContents || reply?.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      ipcMain.removeListener(channels.reply, handler)
      if (reply.error) {
        reject(
          reply.code === 'browser_tab_not_found'
            ? new BrowserError('browser_tab_not_found', reply.error)
            : new Error(reply.error)
        )
      } else {
        resolve()
      }
    }
    ipcMain.on(channels.reply, handler)
    win.webContents.send(channels.request, { ...payload, requestId })
  })
}
