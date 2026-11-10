import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { openGrazrEnrolTerminal } from './grazr-enrol-terminal'
import { grazrLimitResetCommand, type GrazrLimitResetKind } from './grazr-limit-reset-command'

// Why: the reset list is Anthropic's to show and spend, so the dialog hands over to Claude Code's own command.
export function openGrazrLimitResetTerminal(
  worktreeId: string,
  kind: GrazrLimitResetKind
): boolean {
  const opened = openGrazrEnrolTerminal({
    worktreeId,
    command: grazrLimitResetCommand(kind),
    label: translate('grazr.dialog.resetTabLabel', 'Limit reset')
  })
  if (opened === null) {
    toast.error(
      translate('grazr.dialog.resetTerminalFailed', 'Could not open a terminal for the reset.')
    )
    return false
  }
  toast.message(translate('grazr.dialog.finishReset', 'Confirm the reset in the Claude terminal'))
  return true
}
