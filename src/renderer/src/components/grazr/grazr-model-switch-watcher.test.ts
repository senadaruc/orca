import { describe, expect, it, vi } from 'vitest'
import { answerModelSwitchPrompt, type GrazrModelSwitchDeps } from './grazr-model-switch-watcher'

const rule = '─'.repeat(60)
const dialog = (focused = '❯ Switch to Opus 5.5 and continue') => `${rule}
  Fable 5.1 now uses usage credits

  ${focused}
    Set up usage credits on claude.ai

  Enter to confirm · Esc to cancel`
const checking = `${rule}
  Fable 5.1 now uses usage credits

  Checking usage credits…

  Esc to cancel`
const idle = '⏺ Continuing on Opus 5.5.\n\n> \n'

// Plays the given screens one per look, then the last one forever.
function harness(screens: string[]) {
  let look = 0
  const presses: number[] = []
  const reports: string[] = []
  const deps: GrazrModelSwitchDeps = {
    // Looks are 1-based: the first look reads the first screen.
    readScreen: () => screens[Math.min(look, screens.length) - 1] ?? null,
    pressEnter: () => presses.push(look),
    isClaudePane: () => true,
    enabled: () => true,
    sleep: async () => {
      look += 1
    },
    report: (_pty, model) => reports.push(model)
  }
  return { deps, presses, reports }
}

describe('answerModelSwitchPrompt', () => {
  it('presses Enter once the switch option has read the same on two looks, then reports the model', async () => {
    const { deps, presses, reports } = harness([checking, dialog(), dialog(), idle])
    await answerModelSwitchPrompt('pty', deps)
    // Looks are 1-based: the checking step is look 1, the dialog is seen on 2 and 3.
    expect(presses).toEqual([3])
    expect(reports).toEqual(['Opus 5.5'])
  })

  it('sends a swallowed key again after two more looks, at most three times', async () => {
    const { deps, presses, reports } = harness(Array(20).fill(dialog()))
    await answerModelSwitchPrompt('pty', deps)
    expect(presses).toEqual([2, 4, 6])
    // The dialog never left, so nothing is reported.
    expect(reports).toEqual([])
  })

  it('never presses while another option is focused and reports nothing when the dialog closes', async () => {
    const other = dialog('  Switch to Opus 5.5 and continue').replace(
      '    Set up usage credits on claude.ai',
      '  ❯ Set up usage credits on claude.ai'
    )
    const { deps, presses, reports } = harness([other, other, idle])
    await answerModelSwitchPrompt('pty', deps)
    expect(presses).toEqual([])
    expect(reports).toEqual([])
  })

  it('stops when the pane is gone', async () => {
    const deps = harness([]).deps
    const press = vi.fn()
    await answerModelSwitchPrompt('pty', { ...deps, readScreen: () => null, pressEnter: press })
    expect(press).not.toHaveBeenCalled()
  })
})
