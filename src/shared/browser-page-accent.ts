import { z } from 'zod'

const BROWSER_PAGE_ACCENT_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const BROWSER_PAGE_ACCENT_FORMAT_MESSAGE = 'Accent color must be a #rgb or #rrggbb hex color'

/** Only plain hex reaches the page's style, so a value can never carry other CSS. */
export function isBrowserPageAccentColor(value: unknown): value is string {
  return typeof value === 'string' && BROWSER_PAGE_ACCENT_PATTERN.test(value)
}

export const BrowserPageAccentColor = z
  .string(BROWSER_PAGE_ACCENT_FORMAT_MESSAGE)
  .regex(BROWSER_PAGE_ACCENT_PATTERN, BROWSER_PAGE_ACCENT_FORMAT_MESSAGE)

export const BROWSER_PAGE_ACCENT_REQUEST_CHANNEL = 'browser:requestPageAccent'
export const BROWSER_PAGE_ACCENT_REPLY_CHANNEL = 'browser:pageAccentReply'

/** Main asks the renderer, which owns the page records, to set or clear one page's agent accent. */
export type BrowserPageAccentRequest = {
  requestId: string
  browserPageId: string
  /** When set, the page must belong to this worktree. */
  worktreeId?: string
  accentColor: string | null
}

export type BrowserPageAccentReply = {
  requestId: string
  error?: string
  code?: 'browser_tab_not_found'
}
