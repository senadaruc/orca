import { quotePosixShellDoubleQuotedApostrophe } from '../../shared/shell-argument-quoting'

export const GRAZR_REMOTE_ENGINE = '~/.local/share/orca-grazr/engine'
export const GRAZR_REMOTE_STATE = '~/.local/state/orca-grazr'
export const GRAZR_REMOTE_CONFIG = '~/.config/orca-grazr'

export type GrazrVerb =
  | 'status'
  | 'swap'
  | 'refresh'
  | 'set'
  | 'install'
  | 'uninstall'
  | 'notices-drain'

export type GrazrTarget = { remote: boolean; platform: NodeJS.Platform; homedir: string }

// Remote paths keep their literal ~ so the remote shell expands them, never the local home.
function expandHome(path: string, home: string): string {
  return path.replace(/^~/, home)
}

function engineFile(home: string): string {
  return `${expandHome(GRAZR_REMOTE_ENGINE, home)}/grazr.py`
}

export function grazrEngineEnv(target: GrazrTarget): Record<string, string> {
  const home = target.remote ? '~' : target.homedir
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
    args: [engineFile(homedir), verb, ...engineArgs(verb, args)],
    env: grazrEngineEnv({ remote: false, platform, homedir })
  }
}

function renderEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
}

// Every argument is quoted, so an account name cannot inject shell syntax on the remote host.
export function grazrRemoteCommand(verb: GrazrVerb, args: readonly string[]): string {
  const env = renderEnv(grazrEngineEnv({ remote: true, platform: 'linux', homedir: '~' }))
  const quoted = engineArgs(verb, args).map(quotePosixShellDoubleQuotedApostrophe)
  return ['env', env, 'python3', engineFile('~'), verb, ...quoted].join(' ')
}

// The terminal runs this line itself, so enrolment opens an interactive prompt on that host.
export function grazrEnrolTerminalCommand(
  remote: boolean,
  homedir: string,
  platform: NodeJS.Platform
): string {
  const target = { remote, platform, homedir }
  const home = remote ? '~' : homedir
  return [renderEnv(grazrEngineEnv(target)), 'python3', engineFile(home), 'enrol'].join(' ')
}
