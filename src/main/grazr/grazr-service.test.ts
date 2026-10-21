import { describe, expect, it } from 'vitest'
import type { GrazrApi } from '../../shared/grazr-api-types'
import type { GrazrHostRef } from '../../shared/grazr-host'
import type { GrazrEngineRunner, GrazrRunResult } from './grazr-engine-runner'
import type { GrazrVerb } from './grazr-engine-command'
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
    engineRoot: '/app/resources/grazr/engine',
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
        'GRAZR_STATE_DIR=/Users/a/.local/state/orca-grazr GRAZR_CONFIG_DIR=/Users/a/.config/orca-grazr GRAZR_NOTIFIER=osascript python3 /Users/a/.local/share/orca-grazr/engine/grazr.py enrol'
    })
  })
})
