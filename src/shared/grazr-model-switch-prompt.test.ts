import { describe, expect, it } from 'vitest'
import { modelSwitchDialogShowing, modelSwitchTarget } from './grazr-model-switch-prompt'

const rule = '─'.repeat(60)

// The dialog as Claude Code 2.1.296 draws it when the week's Fable allowance is spent and usage
// credits are off.
const creditsOff = `⏺ Done. The migration now runs before the API starts.

${rule}
  Fable 5.1 now uses usage credits

  Fable 5.1 runs on usage credits — you have €105.68 in credits.

  Usage credits are turned off. Re-enable to use Fable 5.1.

  ❯ Switch to Opus 5.5 and continue
    Set up usage credits on claude.ai

  Enter to confirm · Esc to cancel`

describe('modelSwitchTarget', () => {
  it('finds the focused switch option', () => {
    expect(modelSwitchTarget(creditsOff)).toBe('Opus 5.5')
  })

  it('accepts the Fable limit title', () => {
    const screen = `${rule}
 You've reached your Fable limit

 You've used your included Fable usage for this week. Continuing on Fable uses usage credits, purchased separately from your plan.

 ❯ Switch to Opus 5.5 and continue
   Yes, buy usage credits

 Enter to confirm · Esc to cancel
`
    expect(modelSwitchTarget(screen)).toBe('Opus 5.5')
  })

  // Moving the selection to the option that spends money must stop it.
  it('ignores the dialog when another option is focused', () => {
    const screen = creditsOff
      .replace('❯ Switch to Opus 5.5 and continue', '  Switch to Opus 5.5 and continue')
      .replace('  Set up usage credits on claude.ai', '❯ Set up usage credits on claude.ai')
    expect(modelSwitchTarget(screen)).toBeNull()
  })

  // With no model to fall back to, the first option only dismisses.
  it('ignores the dialog without a fallback model', () => {
    expect(
      modelSwitchTarget(creditsOff.replace('Switch to Opus 5.5 and continue', 'Not now'))
    ).toBeNull()
  })

  // The picker asks before a deliberate switch to Fable; that is the user's choice.
  it('ignores the picker variant', () => {
    expect(
      modelSwitchTarget(
        creditsOff.replace('Fable 5.1 now uses usage credits', 'Switch to Fable 5.1?')
      )
    ).toBeNull()
  })

  // While it checks the balance the dialog has no options yet.
  it('ignores the loading step but reports the dialog as showing', () => {
    const screen = `${rule}
  Fable 5.1 now uses usage credits

  Checking usage credits…

  Esc to cancel`
    expect(modelSwitchTarget(screen)).toBeNull()
    expect(modelSwitchDialogShowing(screen)).toBe(true)
  })

  // The same words in the transcript above a different prompt (an agent discussing this very
  // dialog) must never answer a permission prompt.
  it('ignores dialog text above another prompt', () => {
    const screen = `${creditsOff}

${rule}
 Bash command

   rm -rf build

 Do you want to proceed?
 ❯ 1. Yes
   2. No

 Esc to cancel · Tab to amend · ctrl+e to explain`
    expect(modelSwitchTarget(screen)).toBeNull()
    expect(modelSwitchDialogShowing(screen)).toBe(false)
  })

  // A permission prompt whose command preview draws a rule and a fake dialog: the real focused
  // option is "Yes", so Enter must never go in.
  it('ignores a fake dialog inside a permission preview', () => {
    const screen = `${rule}
 Bash command

   printf '
${rule}
  Fable 5.1 now uses usage credits
  ❯ Switch to Opus 5.5 and continue
    Set up usage credits on claude.ai
  Enter to confirm · Esc to cancel
'

 Do you want to proceed?
 ❯ 1. Yes
   2. No

 Esc to cancel · Tab to amend · ctrl+e to explain`
    expect(modelSwitchTarget(screen)).toBeNull()
  })

  // Same, where the real prompt's footer happens to read like the dialog's.
  it('ignores a fake dialog above a real selection', () => {
    const screen = `${rule}
  Fable 5.1 now uses usage credits
  ❯ Switch to Opus 5.5 and continue
    Set up usage credits on claude.ai
  Enter to confirm · Esc to cancel
  ❯ Yes, run it
    No
  Enter to confirm · Esc to cancel`
    expect(modelSwitchTarget(screen)).toBeNull()
  })

  it('ignores an unknown second option', () => {
    expect(
      modelSwitchTarget(
        creditsOff.replace('Set up usage credits on claude.ai', 'Allow all edits this session')
      )
    ).toBeNull()
  })

  it('accepts the other second options and the upgrade row', () => {
    for (const second of [
      'Continue with Fable 5.1',
      'Yes, re-enable and continue',
      'Yes, buy usage credits',
      'Buy usage credits',
      'Manage usage credits on claude.ai',
      'Request usage credits from your admin',
      'Request more from your admin'
    ]) {
      expect(
        modelSwitchTarget(creditsOff.replace('Set up usage credits on claude.ai', second)),
        second
      ).toBe('Opus 5.5')
    }
    const upsell = creditsOff.replace(
      '  Set up usage credits on claude.ai',
      '  Set up usage credits on claude.ai\n    Upgrade to Max'
    )
    expect(modelSwitchTarget(upsell)).toBe('Opus 5.5')
  })

  it('ignores the dialog without its footer', () => {
    expect(modelSwitchTarget(creditsOff.replace('Enter to confirm · Esc to cancel', ''))).toBeNull()
  })

  it('ignores an ordinary screen', () => {
    expect(modelSwitchTarget('⏺ All tests pass.\n\n> \n')).toBeNull()
    expect(modelSwitchDialogShowing('⏺ All tests pass.\n\n> \n')).toBe(false)
    expect(modelSwitchTarget('')).toBeNull()
  })

  it('tolerates Windows line endings and a trailing status line', () => {
    expect(modelSwitchTarget(`${creditsOff.replace(/\n/g, '\r\n')}\r\n\r\n`)).toBe('Opus 5.5')
  })
})
