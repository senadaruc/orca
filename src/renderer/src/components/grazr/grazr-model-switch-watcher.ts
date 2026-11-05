import {
  modelSwitchDialogShowing,
  modelSwitchTarget
} from '../../../../shared/grazr-model-switch-prompt'

// A port of HerdrM's autoSwitchModels: when Claude's usage-credits dialog appears on a Claude pane
// and the setting is on, the pane is read and answered with the switch, so the agent keeps working.

export type GrazrModelSwitchDeps = {
  readScreen: (ptyId: string) => string | null
  pressEnter: (ptyId: string) => void
  isClaudePane: (ptyId: string) => boolean
  enabled: () => boolean
  sleep: (ms: number) => Promise<void>
  report: (ptyId: string, model: string) => void
}

// Why: output arrives in bursts, so a look waits for the screen to settle before reading it.
export const SETTLE_MS = 1000
const LOOK_MS = 1000
const MAX_LOOKS = 12
const MAX_PRESSES = 3

export type GrazrModelSwitchWatcher = {
  screenChanged: (ptyId: string) => void
  dispose: () => void
}

// Presses Enter on the dialog, only while its focused option is the switch to another model, the
// one choice that spends nothing. The dialog first checks the credit balance and ignores keys for
// a moment after each step appears, so the option must read the same on two looks a second apart
// before a key goes in, and a key it swallowed is sent again.
export async function answerModelSwitchPrompt(
  ptyId: string,
  deps: GrazrModelSwitchDeps
): Promise<void> {
  let lastSeen: string | null = null
  let presses = 0
  let target: string | null = null
  for (let look = 0; look < MAX_LOOKS; look++) {
    await deps.sleep(LOOK_MS)
    const screen = deps.readScreen(ptyId)
    if (screen === null) {
      return
    }
    if (!modelSwitchDialogShowing(screen)) {
      if (target !== null) {
        deps.report(ptyId, target)
      }
      return
    }
    const seen = modelSwitchTarget(screen)
    if (seen === null) {
      lastSeen = null
      continue
    }
    if (seen !== lastSeen || presses >= MAX_PRESSES) {
      lastSeen = seen
      continue
    }
    deps.pressEnter(ptyId)
    presses += 1
    target = seen
    // A key the dialog swallowed is sent again, after two more looks.
    lastSeen = null
  }
}

export function createGrazrModelSwitchWatcher(deps: GrazrModelSwitchDeps): GrazrModelSwitchWatcher {
  const settling = new Map<string, ReturnType<typeof setTimeout>>()
  // A pane is read once per dialog: it is checked until the dialog leaves its screen.
  const checked = new Set<string>()
  const answering = new Set<string>()
  let disposed = false

  function look(ptyId: string): void {
    settling.delete(ptyId)
    if (disposed || answering.has(ptyId)) {
      return
    }
    const screen = deps.readScreen(ptyId)
    if (screen === null || !modelSwitchDialogShowing(screen)) {
      checked.delete(ptyId)
      return
    }
    if (checked.has(ptyId) || !deps.enabled() || !deps.isClaudePane(ptyId)) {
      return
    }
    checked.add(ptyId)
    answering.add(ptyId)
    void answerModelSwitchPrompt(ptyId, deps).finally(() => answering.delete(ptyId))
  }

  return {
    screenChanged(ptyId) {
      if (disposed) {
        return
      }
      const pending = settling.get(ptyId)
      if (pending !== undefined) {
        clearTimeout(pending)
      }
      settling.set(
        ptyId,
        setTimeout(() => look(ptyId), SETTLE_MS)
      )
    },
    dispose() {
      disposed = true
      for (const timer of settling.values()) {
        clearTimeout(timer)
      }
      settling.clear()
    }
  }
}
