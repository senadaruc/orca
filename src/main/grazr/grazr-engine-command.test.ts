import { describe, expect, it } from 'vitest'
import {
  grazrEngineEnv,
  grazrEnrolTerminalCommand,
  grazrLocalInvocation,
  grazrRemoteCommand
} from './grazr-engine-command'

const HOME = '/Users/a'

describe('grazrEngineEnv', () => {
  it('points local paths at the home directory and uses osascript on darwin', () => {
    expect(grazrEngineEnv({ remote: false, platform: 'darwin', homedir: HOME })).toEqual({
      GRAZR_STATE_DIR: '/Users/a/.local/state/orca-grazr',
      GRAZR_CONFIG_DIR: '/Users/a/.config/orca-grazr',
      GRAZR_NOTIFIER: 'osascript'
    })
  })

  it('falls back to the queue notifier off darwin', () => {
    expect(grazrEngineEnv({ remote: false, platform: 'linux', homedir: '/home/b' })).toEqual({
      GRAZR_STATE_DIR: '/home/b/.local/state/orca-grazr',
      GRAZR_CONFIG_DIR: '/home/b/.config/orca-grazr',
      GRAZR_NOTIFIER: 'queue'
    })
  })

  it('keeps a literal $HOME for remote hosts and always queues', () => {
    expect(grazrEngineEnv({ remote: true, platform: 'darwin', homedir: HOME })).toEqual({
      GRAZR_STATE_DIR: '$HOME/.local/state/orca-grazr',
      GRAZR_CONFIG_DIR: '$HOME/.config/orca-grazr',
      GRAZR_NOTIFIER: 'queue'
    })
  })
})

describe('grazrLocalInvocation', () => {
  it('runs the engine with python3 and the local environment', () => {
    expect(grazrLocalInvocation('swap', ["o'brien"], HOME, 'darwin')).toEqual({
      program: 'python3',
      args: ['/Users/a/.local/share/orca-grazr/engine/grazr.py', 'swap', "o'brien"],
      env: {
        GRAZR_STATE_DIR: '/Users/a/.local/state/orca-grazr',
        GRAZR_CONFIG_DIR: '/Users/a/.config/orca-grazr',
        GRAZR_NOTIFIER: 'osascript'
      }
    })
  })

  it('always passes --json to status', () => {
    const invocation = grazrLocalInvocation('status', [], HOME, 'linux')
    expect(invocation.args).toEqual([
      '/Users/a/.local/share/orca-grazr/engine/grazr.py',
      'status',
      '--json'
    ])
  })
})

describe('grazrRemoteCommand', () => {
  it('quotes the swap account name byte for byte', () => {
    expect(grazrRemoteCommand('swap', ["o'brien $x"])).toBe(
      `env GRAZR_STATE_DIR="$HOME/.local/state/orca-grazr" GRAZR_CONFIG_DIR="$HOME/.config/orca-grazr" GRAZR_NOTIFIER="queue" python3 "$HOME/.local/share/orca-grazr/engine/grazr.py" swap 'o'\\''brien $x'`
    )
  })

  it('passes --json to status as a quoted argument', () => {
    expect(grazrRemoteCommand('status', [])).toBe(
      `env GRAZR_STATE_DIR="$HOME/.local/state/orca-grazr" GRAZR_CONFIG_DIR="$HOME/.config/orca-grazr" GRAZR_NOTIFIER="queue" python3 "$HOME/.local/share/orca-grazr/engine/grazr.py" status '--json'`
    )
  })
})

describe('grazrEnrolTerminalCommand', () => {
  it('runs enrol locally with the desktop notifier', () => {
    expect(grazrEnrolTerminalCommand(false, HOME, 'darwin')).toBe(
      "GRAZR_STATE_DIR='/Users/a/.local/state/orca-grazr' GRAZR_CONFIG_DIR='/Users/a/.config/orca-grazr' GRAZR_NOTIFIER='osascript' python3 '/Users/a/.local/share/orca-grazr/engine/grazr.py' enrol"
    )
  })

  it('quotes a local home directory with a space as one word', () => {
    expect(grazrEnrolTerminalCommand(false, '/Users/Ada Lovelace', 'darwin')).toBe(
      "GRAZR_STATE_DIR='/Users/Ada Lovelace/.local/state/orca-grazr' GRAZR_CONFIG_DIR='/Users/Ada Lovelace/.config/orca-grazr' GRAZR_NOTIFIER='osascript' python3 '/Users/Ada Lovelace/.local/share/orca-grazr/engine/grazr.py' enrol"
    )
  })

  it('runs enrol on a remote host with $HOME paths and the queue notifier', () => {
    expect(grazrEnrolTerminalCommand(true, HOME, 'darwin')).toBe(
      'GRAZR_STATE_DIR="$HOME/.local/state/orca-grazr" GRAZR_CONFIG_DIR="$HOME/.config/orca-grazr" GRAZR_NOTIFIER="queue" python3 "$HOME/.local/share/orca-grazr/engine/grazr.py" enrol'
    )
  })
})
