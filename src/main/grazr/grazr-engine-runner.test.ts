import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import { describe, expect, it } from 'vitest'
import { SSH_EXEC_TIMEOUT_CODE, sshCommandExitError } from '../ssh/remote-exec/remote-exec-command'
import { SshConnection } from '../ssh/connection/ssh-connection'
import { classifyGrazrOutcome } from './grazr-engine-outcome'
import { createGrazrEngineRunner } from './grazr-engine-runner'

const HOME = '/Users/a'
const processResult = (overrides: Partial<ProcessResult>): ProcessResult => ({
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  ...overrides
})

describe('createGrazrEngineRunner local runs', () => {
  it('spawns python3 with the engine path and the scripted result', async () => {
    const specs: ProcessSpec[] = []
    const runner = createGrazrEngineRunner({
      runProcess: (spec) => {
        specs.push(spec)
        return Promise.resolve(processResult({ stdout: '{"ok":true}' }))
      },
      execCommand: () => Promise.reject(new Error('not used')),
      homedir: () => HOME,
      platform: 'darwin'
    })

    const result = await runner.runLocal('status', [], 5000)

    expect(result).toEqual({
      code: 0,
      stdout: '{"ok":true}',
      stderr: '',
      timedOut: false,
      spawnError: null
    })
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      program: 'python3',
      args: ['/Users/a/.local/share/orca-grazr/engine/grazr.py', 'status', '--json'],
      timeoutMs: 5000
    })
    expect(specs[0]?.env).toMatchObject({
      GRAZR_STATE_DIR: '/Users/a/.local/state/orca-grazr',
      GRAZR_NOTIFIER: 'osascript'
    })
  })

  it('reports a spawn failure as spawnError instead of rejecting', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('spawn python3 ENOENT')),
      execCommand: () => Promise.reject(new Error('not used')),
      homedir: () => HOME,
      platform: 'linux'
    })

    expect(await runner.runLocal('refresh', [], 5000)).toEqual({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: 'spawn python3 ENOENT'
    })
  })
})

describe('createGrazrEngineRunner SSH runs', () => {
  const connection: SshConnection = Object.create(SshConnection.prototype)

  it('sends the remote command and maps a successful resolution to exit 0', async () => {
    const calls: { command: string; timeoutMs: number | undefined }[] = []
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: (_conn, command, options) => {
        calls.push({ command, timeoutMs: options?.timeoutMs })
        return Promise.resolve('{"accounts":[]}')
      },
      homedir: () => HOME,
      platform: 'darwin'
    })

    expect(await runner.runSsh(connection, 'status', [], 8000)).toEqual({
      code: 0,
      stdout: '{"accounts":[]}',
      stderr: '',
      timedOut: false,
      spawnError: null
    })
    expect(calls).toEqual([
      {
        command: `env GRAZR_STATE_DIR="$HOME/.local/state/orca-grazr" GRAZR_CONFIG_DIR="$HOME/.config/orca-grazr" GRAZR_NOTIFIER="queue" python3 "$HOME/.local/share/orca-grazr/engine/grazr.py" status '--json'`,
        timeoutMs: 8000
      }
    ])
  })

  it('maps a nonzero remote exit to its code and stdout', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: (_conn, command) =>
        Promise.reject(sshCommandExitError(command, 1, 'grazr: no such account\n')),
      homedir: () => HOME,
      platform: 'darwin'
    })

    const result = await runner.runSsh(connection, 'swap', ['work'], 8000)

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('grazr: no such account\n')
    expect(result.stderr).toBe('grazr: no such account')
    expect(result.timedOut).toBe(false)
    expect(result.spawnError).toBeNull()
  })

  it('reports an SSH exec timeout as timedOut', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: () =>
        Promise.reject(Object.assign(new Error('timed out'), { code: SSH_EXEC_TIMEOUT_CODE })),
      homedir: () => HOME,
      platform: 'darwin'
    })

    expect(await runner.runSsh(connection, 'refresh', [], 8000)).toEqual({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: true,
      spawnError: null
    })
  })

  it('reports any other transport failure as spawnError', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: () => Promise.reject(new Error('channel closed')),
      homedir: () => HOME,
      platform: 'darwin'
    })

    expect(await runner.runSsh(connection, 'set', ['--x'], 8000)).toEqual({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: 'channel closed'
    })
  })

  it('keeps the account name out of an unreachable-host detail', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: (_conn, command) =>
        Promise.reject(
          sshCommandExitError(
            command,
            255,
            'ssh: connect to host cloud-dev port 22: Operation timed out\n'
          )
        ),
      homedir: () => HOME,
      platform: 'darwin'
    })

    const failure = classifyGrazrOutcome(
      await runner.runSsh(connection, 'swap', ["o'brien"], 8000),
      true
    )

    expect(failure).toEqual({
      kind: 'unreachable',
      detail: 'ssh: connect to host cloud-dev port 22: Operation timed out'
    })
  })

  it('keeps the command echo out of a not-deployed detail', async () => {
    const runner = createGrazrEngineRunner({
      runProcess: () => Promise.reject(new Error('not used')),
      execCommand: (_conn, command) =>
        Promise.reject(
          sshCommandExitError(
            command,
            2,
            "python3: can't open file '/home/a/.local/share/orca-grazr/engine/grazr.py': [Errno 2] No such file or directory\n"
          )
        ),
      homedir: () => HOME,
      platform: 'darwin'
    })

    const failure = classifyGrazrOutcome(await runner.runSsh(connection, 'status', [], 8000), true)

    expect(failure?.kind).toBe('not-deployed')
    expect(failure?.detail).not.toContain('GRAZR_STATE_DIR')
    expect(failure?.detail).not.toContain('Command "')
  })
})
