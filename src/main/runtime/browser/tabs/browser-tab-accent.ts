import type { BrowserTabSetAccentResult } from '../../../../shared/runtime-browser-contracts'
import {
  BROWSER_PAGE_ACCENT_REPLY_CHANNEL,
  BROWSER_PAGE_ACCENT_REQUEST_CHANNEL
} from '../../../../shared/browser-page-accent'
import { BrowserError } from '../../../browser/browser-error'
import type {
  BrowserCommandTargetParams,
  RuntimeBrowserCommandHost
} from '../commands/browser-command-contracts'
import type { RuntimeBrowserCommandTargets } from '../commands/browser-command-targets'
import { requestBrowserTabRendererChange } from './browser-tab-renderer-request'

export class RuntimeBrowserTabAccent {
  constructor(
    private readonly host: Pick<
      RuntimeBrowserCommandHost,
      'getAvailableAuthoritativeWindow' | 'resolveWorkspaceSelector'
    >,
    private readonly targets: Pick<
      RuntimeBrowserCommandTargets,
      'requireAgentBrowserBridge' | 'resolveBrowserCommandTarget'
    >
  ) {}

  async browserTabSetAccent(
    params: { accentColor: string | null } & BrowserCommandTargetParams
  ): Promise<BrowserTabSetAccentResult> {
    const win = this.host.getAvailableAuthoritativeWindow()
    if (!win) {
      throw new BrowserError('browser_error', 'This host does not support browser panes.')
    }
    // A named page is recolored without waking it; only the worktree's active tab needs resolving.
    const worktreeId = params.worktree
      ? (await this.host.resolveWorkspaceSelector(params.worktree)).id
      : undefined
    const browserPageId =
      params.page ||
      this.targets
        .requireAgentBrowserBridge()
        .getActivePageId((await this.targets.resolveBrowserCommandTarget(params)).worktreeId)
    if (!browserPageId) {
      throw new BrowserError('browser_no_tab', 'No browser tab open in this worktree')
    }
    await requestBrowserTabRendererChange(
      win,
      { request: BROWSER_PAGE_ACCENT_REQUEST_CHANNEL, reply: BROWSER_PAGE_ACCENT_REPLY_CHANNEL },
      { browserPageId, worktreeId, accentColor: params.accentColor },
      'Tab accent update timed out'
    )
    return { browserPageId, accentColor: params.accentColor }
  }
}
