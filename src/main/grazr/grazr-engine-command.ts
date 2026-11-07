import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'

// A literal $HOME, expanded by the remote shell inside double quotes; zsh does not expand a bare ~ in an assignment.
export const GRAZR_REMOTE_ENGINE = '$HOME/.local/share/orca-grazr/engine'
export const GRAZR_REMOTE_STATE = '$HOME/.local/state/orca-grazr'
export const GRAZR_REMOTE_CONFIG = '$HOME/.config/orca-grazr'

export type GrazrVerb =
  | 'status'
  | 'swap'
  | 'refresh'
  | 'set'
  | 'install'
  | 'uninstall'
  | 'notices-drain'

export type GrazrTarget = { remote: boolean; platform: NodeJS.Platform; homedir: string }

const REMOTE_HOME = '$HOME'

function expandHome(path: string, home: string): string {
  return path.replace(/^\$HOME/, home)
}

function enginePath(home: string): string {
  return `${expandHome(GRAZR_REMOTE_ENGINE, home)}/grazr.py`
}

export function grazrEngineEnv(target: GrazrTarget): Record<string, string> {
  const home = target.remote ? REMOTE_HOME : target.homedir
  const notifier = !target.remote && target.platform === 'darwin' ? 'osascript' : 'queue'
  return {
    GRAZR_STATE_DIR: expandHome(GRAZR_REMOTE_STATE, home),
    GRAZR_CONFIG_DIR: expandHome(GRAZR_REMOTE_CONFIG, home),
    GRAZR_NOTIFIER: notifier
  }
}

// status is always read as JSON, so the caller never has to remember the flag.
function engineArgs(verb: GrazrVerb, args: readonly string[]): string[] {
  return verb === 'status' ? ['--json', ...args] : [...args]
}

export function grazrLocalInvocation(
  verb: GrazrVerb,
  args: readonly string[],
  homedir: string,
  platform: NodeJS.Platform
): { program: 'python3'; args: string[]; env: Record<string, string> } {
  return {
    program: 'python3',
    args: [enginePath(homedir), verb, ...engineArgs(verb, args)],
    env: grazrEngineEnv({ remote: false, platform, homedir })
  }
}

// Remote values are double-quoted so the remote shell expands $HOME in them.
function renderEnv(env: Record<string, string>, quoteValues: boolean): string {
  return Object.entries(env)
    .map(([key, value]) => (quoteValues ? `${key}="${value}"` : `${key}=${value}`))
    .join(' ')
}

// Every argument is quoted, so an account name cannot inject shell syntax on the remote host.
export function grazrRemoteCommand(verb: GrazrVerb, args: readonly string[]): string {
  const env = renderEnv(grazrEngineEnv({ remote: true, platform: 'linux', homedir: '' }), true)
  const quoted = engineArgs(verb, args).map(quotePosixShell)
  return ['env', env, 'python3', `"${enginePath(REMOTE_HOME)}"`, verb, ...quoted].join(' ')
}

// The terminal runs this line itself, so enrolment opens an interactive prompt on that host.
export function grazrEnrolTerminalCommand(
  remote: boolean,
  homedir: string,
  platform: NodeJS.Platform
): string {
  const env = grazrEngineEnv({ remote, platform, homedir })
  if (remote) {
    return [renderEnv(env, true), 'python3', `"${enginePath(REMOTE_HOME)}"`, 'enrol'].join(' ')
  }
  // Why: a home directory with spaces or quotes must reach the local shell as one word.
  const localEnv = Object.entries(env)
    .map(([key, value]) => `${key}=${quotePosixShell(value)}`)
    .join(' ')
  return [localEnv, 'python3', quotePosixShell(enginePath(homedir)), 'enrol'].join(' ')
}
