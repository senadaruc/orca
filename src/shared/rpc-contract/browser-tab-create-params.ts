import { z } from 'zod'
import { RUNTIME_NAVIGATION_TARGETS } from '../runtime-navigation'
import { BrowserPageCreationPlacement } from '../browser/client-hosting/browser-client-host-placement'
import { OptionalString } from './rpc-param-primitives'
import { BROWSER_TAB_SPLIT_DIRECTIONS } from '../browser-tab-split-direction'
import { BrowserPageAccentColor } from '../browser-page-accent'

export const BrowserTabCreateParams = z.object({
  url: OptionalString,
  worktree: OptionalString,
  page: OptionalString,
  profileId: OptionalString,
  waitForRegistration: z.boolean().optional(),
  activate: z.boolean().optional(),
  // Why: `activate` says the caller wants the new tab selected; `navigation` says on whose screens.
  // Absent, a paired caller means 'caller' — one device's create must not steer every other UI.
  navigation: z.enum(RUNTIME_NAVIGATION_TARGETS).optional(),
  targetGroupId: OptionalString,
  placement: BrowserPageCreationPlacement.optional(),
  // Why optional: older hosts drop unknown fields and fall back to a plain tab, which is safe.
  split: z.enum(BROWSER_TAB_SPLIT_DIRECTIONS).optional(),
  // The terminal tab the split is placed beside; absent or stale falls back to the active pane.
  splitFromTabId: OptionalString,
  // Colors the agent glow on this page; older hosts drop it and keep the default accent.
  accentColor: BrowserPageAccentColor.optional()
})

export const BrowserOpenUrlParams = z.object({
  url: z.url(),
  worktree: z.string().min(1)
})
