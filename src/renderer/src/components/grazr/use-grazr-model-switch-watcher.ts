import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import {
  onPtyScreenChanged,
  ptyScreenPane,
  readPtyScreen
} from '../terminal-pane/pty-screen-readers'
import { createGrazrModelSwitchWatcher } from './grazr-model-switch-watcher'

function tabOf(tabId: string) {
  for (const tabs of Object.values(useAppStore.getState().tabsByWorktree)) {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) {
      return tab
    }
  }
  return null
}

// A Claude pane: its hook-fed status names the agent, or the tab was launched as Claude.
function isClaudePane(ptyId: string): boolean {
  const pane = ptyScreenPane(ptyId)
  if (pane === null) {
    return false
  }
  const status = useAppStore.getState().agentStatusByPaneKey[makePaneKey(pane.tabId, pane.leafId)]
  return status?.agentType === 'claude' || tabOf(pane.tabId)?.launchAgent === 'claude'
}

/** Answers Claude's usage-credits dialog with the model switch on every Claude pane, while the
 *  Claude Accounts setting is on. */
export function useGrazrModelSwitchWatcher(): void {
  useEffect(() => {
    const watcher = createGrazrModelSwitchWatcher({
      readScreen: readPtyScreen,
      pressEnter: (ptyId) => window.api.pty.write(ptyId, '\r', 'driving'),
      isClaudePane,
      enabled: () => useAppStore.getState().settings?.grazrAutoModelSwitch === true,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      report: (ptyId, model) => {
        const pane = ptyScreenPane(ptyId)
        const name = (pane && tabOf(pane.tabId)?.title) || ptyId
        toast.message(
          translate('grazr.modelSwitch.title', 'grazr: {{name}} switched to {{model}}', {
            name,
            model
          }),
          {
            description: translate(
              'grazr.modelSwitch.body',
              'Its Fable allowance ran out and usage credits are off, so it continues on {{model}}.',
              { model }
            )
          }
        )
      }
    })
    const unsubscribe = onPtyScreenChanged(watcher.screenChanged)
    return () => {
      unsubscribe()
      watcher.dispose()
    }
  }, [])
}
