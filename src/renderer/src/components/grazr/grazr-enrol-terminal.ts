import { useAppStore } from '@/store'
import { persistAgentLaunchTabOrder } from '@/lib/agent-session/launch/pane/launch-agent-tab-order'

export function openGrazrEnrolTerminal(args: {
  worktreeId: string
  command: string
  label: string
}): { tabId: string } | null {
  // Why: a blank command would open a terminal that types nothing and leaves the user guessing.
  if (!args.command.trim()) {
    return null
  }
  const store = useAppStore.getState()
  const tab = store.createTab(args.worktreeId, undefined, undefined, {
    quickCommandLabel: args.label,
    pendingStartup: { command: args.command }
  })
  // Why: a worktree showing an editor would keep the editor on top and hide the new terminal.
  store.setActiveTabType('terminal', args.worktreeId)
  // Why: without this the new tab sorts to the front of the tab bar.
  persistAgentLaunchTabOrder(args.worktreeId, tab.id)
  return { tabId: tab.id }
}
