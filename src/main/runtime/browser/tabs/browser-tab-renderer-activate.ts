import { requestBrowserTabRendererChange } from './browser-tab-renderer-request'

/** Asks the renderer, which owns Orca's tab model, to make one browser page the active tab. */
export async function activateBrowserTabInRenderer(
  win: Electron.BrowserWindow,
  browserPageId: string
): Promise<void> {
  await requestBrowserTabRendererChange(
    win,
    { request: 'browser:requestTabActivate', reply: 'browser:tabActivateReply' },
    { browserPageId },
    'Tab activation timed out'
  )
}
