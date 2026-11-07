// Claude Code's usage-credits dialog, read off a pane's visible screen. A port of HerdrM's
// ModelSwitchPrompt.
//
// When the week's Fable allowance is spent, Claude Code stops before the next request and asks in
// the terminal: switch to its fallback model, or pay for Fable with usage credits. No API call
// fails, so nothing reaches grazr, and an unattended agent waits on the dialog until someone
// answers it.
//
// This recognises that dialog only when its focused option is the switch to another model, the
// one choice that spends nothing. Pressing Enter on a wrong match could approve a permission
// prompt, and the screen shows text an agent controls (a command preview, a transcript), so the
// match is the dialog's whole shape, not its words: the last bordered block on screen (the live
// prompt) must start with the dialog's title, end with its exact footer, hold exactly one focused
// line, and list only the dialog's own options from there. A real prompt below a forged dialog
// adds its own focused line or footer and fails the match.

// Title, a body that wraps in a narrow pane, two or three options, the footer. Generous on
// purpose: the shape checks are the guard.
const MAX_DIALOG_LINES = 16
const CONFIRM_FOOTER = 'Enter to confirm · Esc to cancel'
const FOCUSED_SWITCH = /^❯\s*Switch to (.+?) and continue$/

// The option Claude Code lists after the switch, by credit state.
const SECOND_OPTIONS = new Set([
  'Yes, re-enable and continue',
  'Yes, buy usage credits',
  'Buy usage credits',
  'Set up usage credits on claude.ai',
  'Manage usage credits on claude.ai',
  'Request usage credits from your admin',
  'Request more from your admin'
])

function isRule(line: string): boolean {
  return line.length >= 8 && /^[─━]+$/.test(line)
}

function isDialogTitle(line: string | undefined): boolean {
  return (
    line !== undefined &&
    (line.endsWith(' now uses usage credits') || line === "You've reached your Fable limit")
  )
}

function isSecondOption(line: string): boolean {
  return SECOND_OPTIONS.has(line) || line.startsWith('Continue with ')
}

// The trimmed, non-empty lines after the last horizontal rule. Claude draws one above every
// dialog and prompt it shows.
function liveRegion(screen: string): string[] | null {
  const lines = screen
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  const rule = lines.findLastIndex(isRule)
  if (rule === -1) {
    return null
  }
  const region = lines.slice(rule + 1).filter((line) => line !== '')
  return region.length === 0 ? null : region
}

/** The model the focused option would switch to ("Opus 5.5"), or null when the screen is not the
 *  dialog with that option focused. */
export function modelSwitchTarget(screen: string): string | null {
  const region = liveRegion(screen)
  if (
    region === null ||
    region.length > MAX_DIALOG_LINES ||
    !isDialogTitle(region[0]) ||
    region.at(-1) !== CONFIRM_FOOTER
  ) {
    return null
  }
  const focusedLines = region.flatMap((line, i) => (line.startsWith('❯') ? [i] : []))
  const focused = focusedLines[0]
  if (focusedLines.length !== 1 || focused === undefined) {
    return null
  }
  const model = region[focused]?.match(FOCUSED_SWITCH)?.[1]
  if (model === undefined) {
    return null
  }
  // Between the focused switch and the footer: the dialog's second option, and at most its upgrade row.
  const others = region.slice(focused + 1, -1)
  const [second, ...rest] = others
  if (
    others.length < 1 ||
    others.length > 2 ||
    second === undefined ||
    !isSecondOption(second) ||
    !rest.every((line) => line === 'Upgrade to Max')
  ) {
    return null
  }
  return model
}

/** True while the live prompt is this dialog, focused option or not. Its first step only checks
 *  the balance, so the options come a moment later. */
export function modelSwitchDialogShowing(screen: string): boolean {
  const region = liveRegion(screen)
  return region !== null && isDialogTitle(region[0])
}
