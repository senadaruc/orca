// Claude Code's own command for using a limit reset; it asks for confirmation before anything is spent.
export type GrazrLimitResetKind = 'fable' | 'full'

export function grazrLimitResetCommand(kind: GrazrLimitResetKind): string {
  return `claude '/limit-reset ${kind}'`
}
