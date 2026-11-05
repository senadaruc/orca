import type { Terminal } from '@xterm/xterm'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'

// The visible screen of each live pane, by PTY, for readers that act on what Claude draws (the
// usage-credits dialog). A pane registers when its PTY binds and leaves when the binding clears.

export type PtyScreenPane = { tabId: string; leafId: TerminalLeafId; terminal: Terminal }
type Entry = PtyScreenPane & { subscription: { dispose: () => void } | null }

const entries = new Map<string, Entry>()
const listeners = new Set<(ptyId: string) => void>()

// Why: a pane's output is only watched while someone listens, so an idle registry costs nothing.
function watch(ptyId: string, entry: Entry): void {
  if (entry.subscription === null && listeners.size > 0) {
    entry.subscription = entry.terminal.onWriteParsed(() => {
      for (const listener of listeners) {
        listener(ptyId)
      }
    })
  }
}

export function registerPtyScreenReader(ptyId: string, pane: PtyScreenPane): void {
  unregisterPtyScreenReader(ptyId)
  const entry: Entry = { ...pane, subscription: null }
  entries.set(ptyId, entry)
  watch(ptyId, entry)
}

export function unregisterPtyScreenReader(ptyId: string): void {
  entries.get(ptyId)?.subscription?.dispose()
  entries.delete(ptyId)
}

export function ptyScreenPane(ptyId: string): PtyScreenPane | null {
  const entry = entries.get(ptyId)
  return entry ? { tabId: entry.tabId, leafId: entry.leafId, terminal: entry.terminal } : null
}

/** The visible rows of the pane's screen, top to bottom, or null when the PTY has no pane. */
export function readPtyScreen(ptyId: string): string | null {
  const entry = entries.get(ptyId)
  if (!entry) {
    return null
  }
  const buffer = entry.terminal.buffer.active
  const rows: string[] = []
  for (let row = 0; row < entry.terminal.rows; row++) {
    rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
  }
  return rows.join('\n')
}

/** Fires with the PTY whose screen just took new output. */
export function onPtyScreenChanged(listener: (ptyId: string) => void): () => void {
  listeners.add(listener)
  for (const [ptyId, entry] of entries) {
    watch(ptyId, entry)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      for (const entry of entries.values()) {
        entry.subscription?.dispose()
        entry.subscription = null
      }
    }
  }
}
