import { describe, expect, it, vi } from 'vitest'
import type { GrazrApi } from '../../shared/grazr-api-types'
import type { GrazrHostRef } from '../../shared/grazr-host'
import { sshCommandExitError } from '../ssh/remote-exec/remote-exec-command'
import type { GrazrEngineRunner, GrazrRunResult, GrazrSshConnection } from './grazr-engine-runner'
import type { GrazrVerb } from './grazr-engine-command'
import { resolveGrazrHost } from './grazr-host-resolver'
import { createGrazrService, type GrazrServiceDeps } from './grazr-service'

const LOCAL: GrazrHostRef = { kind: 'local' }

const OK: GrazrRunResult = {
  code: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  spawnError: null
}

const STATUS_JSON = JSON.stringify({ version: '1.4.0', installed: true, accounts: [] })

type Call = { verb: GrazrVerb; args: readonly string[] }

// Answers every local call with the scripted result and records the verb and arguments.
function scriptedRunner(
  result: Partial<GrazrRunResult>,
  calls: Call[] = [],
  events: string[] = []
): GrazrEngineRunner {
  return {
    async runLocal(verb, args) {
      calls.push({ verb, args })
      events.push('start')
      await Promise.resolve()
      events.push('end')
      return { ...OK, ...result }
    },
    runSsh() {
      return Promise.reject(new Error('ssh is not scripted in this test'))
    }
  }
}

function service(runner: GrazrEngineRunner, overrides: Partial<GrazrServiceDeps> = {}): GrazrApi {
  return createGrazrService({
    runner,
    resolve: () => ({ kind: 'local' }),
    getConnection: () => undefined,
    execCommand: () => Promise.reject(new Error('ssh is not scripted in this test')),
    resolveEngineRoot: () => '/app/resources/grazr/engine',
    readEngineVersion: () => Promise.resolve('1.4.0'),
    copyDir: () => Promise.resolve(),
    homedir: () => '/Users/a',
    platform: 'darwin',
    ...overrides
  })
}

describe('createGrazrService status', () => {
  it('parses the status report the engine prints', async () => {
    const grazr = service(scriptedRunner({ stdout: STATUS_JSON }))
    const status = await grazr.status(LOCAL)
    expect(status.label).toBe('This computer')
    expect(status.outcome).toMatchObject({ kind: 'ok', report: { installed: true } })
  })

  it('flags a deployed engine whose version differs from the bundled one', async () => {
    const readEngineVersion = vi.fn(() => Promise.resolve('1.5.0'))
    const grazr = service(scriptedRunner({ stdout: STATUS_JSON }), { readEngineVersion })
    const status = await grazr.status(LOCAL)
    expect(readEngineVersion).toHaveBeenCalledWith('/app/resources/grazr/engine')
    expect(status).toMatchObject({ engineOutdated: true, bundledEngineVersion: '1.5.0' })
  })

  it('does not flag a deployed engine that matches the bundled version', async () => {
    const grazr = service(scriptedRunner({ stdout: STATUS_JSON }))
    expect(await grazr.status(LOCAL)).toMatchObject({
      engineOutdated: false,
      bundledEngineVersion: '1.4.0'
    })
  })

  it('does not flag a host without the engine, whatever the bundled version', async () => {
    const grazr = service(scriptedRunner({ code: 2, stderr: 'No such file' }), {
      readEngineVersion: () => Promise.resolve('1.5.0')
    })
    expect(await grazr.status(LOCAL)).toMatchObject({
      outcome: { kind: 'not-deployed' },
      engineOutdated: false
    })
  })

  it('does not resolve the engine root until a status or deploy needs it', () => {
    const resolveEngineRoot = vi.fn(() => '/app/resources/grazr/engine')
    service(scriptedRunner({}), { resolveEngineRoot })
    expect(resolveEngineRoot).not.toHaveBeenCalled()
  })

  it('reports a host without the engine file as not deployed', async () => {
    const grazr = service(
      scriptedRunner({
        code: 2,
        stderr: "python3: can't open file '/x/grazr.py': [Errno 2] No such file or directory"
      })
    )
    expect((await grazr.status(LOCAL)).outcome).toEqual({ kind: 'not-deployed' })
  })

  it('reports a timed-out status as unreachable with a message', async () => {
    const grazr = service(scriptedRunner({ code: null, timedOut: true }))
    expect((await grazr.status(LOCAL)).outcome).toEqual({
      kind: 'unreachable',
      message: 'The engine timed out.'
    })
  })

  it('runs two status calls for one host one after the other', async () => {
    const events: string[] = []
    const grazr = service(scriptedRunner({ stdout: STATUS_JSON }, [], events))
    await Promise.all([grazr.status(LOCAL), grazr.status(LOCAL)])
    expect(events).toEqual(['start', 'end', 'start', 'end'])
  })

  it('reports an unsupported platform without running the engine', async () => {
    const calls: Call[] = []
    const grazr = service(scriptedRunner({}, calls), {
      resolve: () => ({ kind: 'unsupported-platform' })
    })
    expect((await grazr.status(LOCAL)).outcome).toEqual({ kind: 'unsupported-platform' })
    expect(calls).toEqual([])
  })
})

describe('createGrazrService actions', () => {
  it('passes the account name to swap', async () => {
    const calls: Call[] = []
    await service(scriptedRunner({}, calls)).swap(LOCAL, 'work')
    expect(calls).toEqual([{ verb: 'swap', args: ['work'] }])
  })

  it('passes --force to install when forced', async () => {
    const calls: Call[] = []
    await service(scriptedRunner({}, calls)).install(LOCAL, true)
    expect(calls).toEqual([{ verb: 'install', args: ['--force'] }])
  })

  it('reports a refusal because another grazr owns the status line as foreign', async () => {
    const result = await service(
      scriptedRunner({
        code: 1,
        stderr: 'grazr: the status line already belongs to another grazr'
      })
    ).install(LOCAL, false)
    expect(result).toEqual({
      ok: false,
      foreignOwner: true,
      message: 'the status line already belongs to another grazr'
    })
  })

  it('sets the enabled flag as ENABLED 1 or 0', async () => {
    const calls: Call[] = []
    const grazr = service(scriptedRunner({}, calls))
    await grazr.setEnabled(LOCAL, true)
    await grazr.setEnabled(LOCAL, false)
    expect(calls).toEqual([
      { verb: 'set', args: ['ENABLED', '1'] },
      { verb: 'set', args: ['ENABLED', '0'] }
    ])
  })

  it('keeps the engine lines as the success message', async () => {
    const result = await service(scriptedRunner({ stdout: 'Swapped to work\n' })).swap(LOCAL)
    expect(result).toEqual({ ok: true, message: 'Swapped to work' })
  })

  it('drops notice lines that are not JSON notices', async () => {
    const stdout = [
      '{"ts":"2026-10-22T10:00:00Z","title":"Swapped","body":"work"}',
      'not json',
      '{"ts":"2026-10-22T10:01:00Z","title":"Missing body"}'
    ].join('\n')
    const notices = await service(scriptedRunner({ stdout })).drainNotices(LOCAL)
    expect(notices).toEqual([{ ts: '2026-10-22T10:00:00Z', title: 'Swapped', body: 'work' }])
  })
})

describe('createGrazrService enrolCommand', () => {
  it('returns the terminal command for the local host', async () => {
    const result = await service(scriptedRunner({})).enrolCommand(LOCAL)
    expect(result).toEqual({
      command:
        "GRAZR_STATE_DIR='/Users/a/.local/state/orca-grazr' GRAZR_CONFIG_DIR='/Users/a/.config/orca-grazr' GRAZR_NOTIFIER='osascript' python3 '/Users/a/.local/share/orca-grazr/engine/grazr.py' enrol"
    })
  })
})

const SSH: GrazrHostRef = { kind: 'ssh', sshTargetId: 'target-1' }
const SSH_RESOLVED = { kind: 'ssh' as const, sshTargetId: 'target-1', label: 'Builder' }
const ENGINE_DIR = '/home/ada/.local/share/orca-grazr/engine'

function sshConnection(
  uploadDirectory: GrazrSshConnection['uploadDirectory'] = () => Promise.resolve()
): GrazrSshConnection {
  return {
    exec: () => Promise.reject(new Error('exec is not scripted in this test')),
    execWithClosedStdin: () => Promise.reject(new Error('stdin exec is not scripted in this test')),
    usesSystemSshTransport: () => false,
    uploadDirectory
  }
}

// Scripts $HOME and mkdir, and logs every remote command and upload in order.
function remoteFakes(home: string, mkdir: () => Promise<string> = () => Promise.resolve('')) {
  const log: string[] = []
  const execCommand: GrazrServiceDeps['execCommand'] = (_connection, command) => {
    log.push(`exec: ${command}`)
    return command.startsWith('printf') ? Promise.resolve(home) : mkdir()
  }
  return { log, execCommand }
}

describe('createGrazrService timeouts', () => {
  it('bounds each engine verb by its own timeout', async () => {
    const timeouts: Partial<Record<GrazrVerb, number>> = {}
    const runner: GrazrEngineRunner = {
      async runLocal(verb, _args, timeoutMs) {
        timeouts[verb] = timeoutMs
        return { ...OK, stdout: '' }
      },
      runSsh: () => Promise.reject(new Error('not scripted'))
    }
    const grazr = service(runner)
    await grazr.status(LOCAL)
    await grazr.refresh(LOCAL)
    await grazr.swap(LOCAL)
    await grazr.setEnabled(LOCAL, true)
    await grazr.install(LOCAL, false)
    await grazr.uninstall(LOCAL)
    await grazr.drainNotices(LOCAL)
    expect(timeouts).toEqual({
      status: 10_000,
      refresh: 10_000,
      swap: 10_000,
      set: 10_000,
      install: 20_000,
      uninstall: 20_000,
      'notices-drain': 10_000
    })
  })
})

describe('createGrazrService SSH hosts', () => {
  it('passes the SSH connection to the runner for status', async () => {
    const connection = sshConnection()
    const seen: GrazrSshConnection[] = []
    const runner: GrazrEngineRunner = {
      runLocal: () => Promise.reject(new Error('local is not scripted')),
      async runSsh(conn) {
        seen.push(conn)
        return { ...OK, stdout: STATUS_JSON }
      }
    }
    const grazr = service(runner, {
      resolve: () => SSH_RESOLVED,
      getConnection: () => connection
    })
    const status = await grazr.status(SSH)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(connection)
    expect(status).toMatchObject({ label: 'Builder', outcome: { kind: 'ok' } })
  })

  it('deploys by resolving $HOME, then creating the directory, then uploading', async () => {
    const { log, execCommand } = remoteFakes('/home/ada\n')
    const uploads: string[] = []
    const grazr = service(scriptedRunner({}), {
      resolve: () => SSH_RESOLVED,
      getConnection: () =>
        sshConnection((_local, remote) => {
          uploads.push(remote)
          log.push(`upload: ${remote}`)
          return Promise.resolve()
        }),
      execCommand
    })
    const result = await grazr.deploy(SSH)
    expect(result.ok).toBe(true)
    expect(log).toEqual([
      'exec: printf %s "$HOME"',
      `exec: mkdir -p '${ENGINE_DIR}'`,
      `upload: ${ENGINE_DIR}`
    ])
    expect(uploads).toEqual([ENGINE_DIR])
  })

  it('reports a failed upload as not ok', async () => {
    const { execCommand } = remoteFakes('/home/ada')
    const grazr = service(scriptedRunner({}), {
      resolve: () => SSH_RESOLVED,
      getConnection: () => sshConnection(() => Promise.reject(new Error('disk full'))),
      execCommand
    })
    expect(await grazr.deploy(SSH)).toEqual({ ok: false, message: 'disk full' })
  })

  it('refuses to deploy when the remote home is not an absolute path', async () => {
    const { log, execCommand } = remoteFakes('')
    const grazr = service(scriptedRunner({}), {
      resolve: () => SSH_RESOLVED,
      getConnection: () => sshConnection(),
      execCommand
    })
    expect(await grazr.deploy(SSH)).toEqual({
      ok: false,
      message: 'Could not resolve the remote home directory.'
    })
    expect(log).toEqual(['exec: printf %s "$HOME"'])
  })

  it('reports a failed mkdir with its exit status and output', async () => {
    const { execCommand } = remoteFakes('/home/ada', () =>
      Promise.reject(sshCommandExitError('mkdir -p', 1, '', 'Permission denied'))
    )
    const grazr = service(scriptedRunner({}), {
      resolve: () => SSH_RESOLVED,
      getConnection: () => sshConnection(),
      execCommand
    })
    const result = await grazr.deploy(SSH)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('exit 1')
    expect(result.message).toContain('Permission denied')
  })

  it('bounds a hung deploy at sixty seconds and frees the host queue', async () => {
    vi.useFakeTimers()
    try {
      const { execCommand } = remoteFakes('/home/ada')
      let uploadSignal: AbortSignal | undefined
      const runner: GrazrEngineRunner = {
        runLocal: () => Promise.reject(new Error('local is not scripted')),
        runSsh: () => Promise.resolve({ ...OK, stdout: STATUS_JSON })
      }
      const grazr = service(runner, {
        resolve: () => SSH_RESOLVED,
        getConnection: () =>
          sshConnection((_local, _remote, options) => {
            uploadSignal = options?.signal
            return new Promise<void>(() => {})
          }),
        execCommand
      })
      const pending = grazr.deploy(SSH)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await pending).toEqual({ ok: false, message: 'Deploying the engine timed out.' })
      expect(uploadSignal?.aborted).toBe(true)
      const next = await grazr.status(SSH)
      expect(next.outcome).toMatchObject({ kind: 'ok' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the remote form of the enrol command', async () => {
    const result = await service(scriptedRunner({}), {
      resolve: () => SSH_RESOLVED
    }).enrolCommand(SSH)
    expect(result).toEqual({
      command:
        'GRAZR_STATE_DIR="$HOME/.local/state/orca-grazr" GRAZR_CONFIG_DIR="$HOME/.config/orca-grazr" GRAZR_NOTIFIER="queue" python3 "$HOME/.local/share/orca-grazr/engine/grazr.py" enrol'
    })
  })

  it('reports no SSH access for an environment without a link and never runs the engine', async () => {
    const calls: Call[] = []
    const grazr = service(scriptedRunner({}, calls), {
      resolve: (host) =>
        resolveGrazrHost(host, {
          listEnvironments: () => [],
          getConnection: () => undefined,
          platform: 'darwin'
        })
    })
    const status = await grazr.status({ kind: 'environment', environmentId: 'env-1' })
    expect(status.outcome).toEqual({ kind: 'no-ssh-access' })
    expect(calls).toEqual([])
  })
})

describe('createGrazrService owner refusals', () => {
  it('does not flag a successful run that mentions another owner', async () => {
    const result = await service(
      scriptedRunner({ stdout: 'the status line already belongs to another grazr' })
    ).install(LOCAL, false)
    expect(result).toEqual({
      ok: true,
      message: 'the status line already belongs to another grazr'
    })
  })
})

describe('createGrazrService setAccounts', () => {
  it('writes the order as one ACCOUNTS value and hands back an engine refusal in its words', async () => {
    const calls: Call[] = []
    const grazr = service(scriptedRunner({ stdout: 'ACCOUNTS=gmail icloud' }, calls))
    expect(await grazr.setAccounts(LOCAL, ['gmail', 'icloud'])).toEqual({
      ok: true,
      message: 'ACCOUNTS=gmail icloud'
    })
    expect(calls).toEqual([{ verb: 'set', args: ['ACCOUNTS', 'gmail icloud'] }])

    const older = service(
      scriptedRunner({ code: 1, stdout: 'grazr: only ENABLED, MODEL_LIMITS can be set this way\n' })
    )
    const refused = await older.setAccounts(LOCAL, ['gmail'])
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('can be set this way')
  })
})
