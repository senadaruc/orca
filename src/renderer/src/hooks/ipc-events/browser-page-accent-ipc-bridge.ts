import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { findPage } from '../../store/slices/browser-page-records'
import {
  BROWSER_PAGE_ACCENT_FORMAT_MESSAGE,
  isBrowserPageAccentColor
} from '../../../../shared/browser-page-accent'

/** Main sets or clears the color of one page's agent glow; null clears it. */
export function registerBrowserPageAccentIpcBridge(unsubs: (() => void)[]): void {
  const subscribe = window.api.browser?.onRequestPageAccent
  const reply = window.api.browser?.replyPageAccent
  if (!subscribe || !reply) {
    return
  }
  unsubs.push(
    subscribe(({ requestId, browserPageId, worktreeId, accentColor }) => {
      if (accentColor !== null && !isBrowserPageAccentColor(accentColor)) {
        reply({ requestId, error: BROWSER_PAGE_ACCENT_FORMAT_MESSAGE })
        return
      }
      const store = useAppStore.getState()
      const page = findPage(store.browserPagesByWorkspace, browserPageId)
      if (!page || (worktreeId && page.worktreeId !== worktreeId)) {
        reply({
          requestId,
          code: 'browser_tab_not_found',
          error: translate(
            'auto.hooks.useIpcEvents.0e3cf53060',
            'Browser tab {{value0}} not found',
            {
              value0: browserPageId
            }
          )
        })
        return
      }
      store.setBrowserPageAccentColor(page.id, accentColor)
      reply({ requestId })
    })
  )
}
