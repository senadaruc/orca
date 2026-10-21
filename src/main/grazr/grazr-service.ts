import { join } from 'node:path'
import { z } from 'zod'
import type {
  GrazrApi,
  GrazrActionResult,
  GrazrHostOutcome,
  GrazrHostStatus,
  GrazrNotice
} from '../../shared/grazr-api-types'
import { grazrHostKey, type GrazrHostRef } from '../../shared/grazr-host'
import { parseGrazrStatusReport } from '../../shared/grazr-status-report'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import type { SshConnection } from '../ssh/connection/ssh-connection'
import type { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { grazrEnrolTerminalCommand, type GrazrVerb } from './grazr-engine-command'
import { classifyGrazrOutcome, type GrazrFailure } from './grazr-engine-outcome'
import type { GrazrEngineRunner, GrazrRunResult } from './grazr-engine-runner'
import type { GrazrResolvedHost } from './grazr-host-resolver'

export type GrazrServiceDeps = {
  runner: GrazrEngineRunner
  resolve: (host: GrazrHostRef) => GrazrResolvedHost
  getConnection: (sshTargetId: string) => SshConnection | undefined
  execCommand: typeof execCommand
  engineRoot: string
  copyDir: (from: string, to: string) => Promise<void>
  homedir: () => string
  platform: NodeJS.Platform
}

const STATUS_TIMEOUT_MS = 20_000
const ACTION_TIMEOUT_MS = 120_000
const NOTICES_TIMEOUT_MS = 20_000
const LOCAL_LABEL = 'This computer'
const FOREIGN_OWNER = 'already belongs'
const ENGINE_DIR_SEGMENTS = ['.local', 'share', 'orca-grazr', 'engine']

const NoticeSchema = z.object({ ts: z.string(), title: z.string(), body: z.string() })

// A host that cannot run the engine yields no run result, only the reason it could not.
type Invocation =
  | { kind: 'blocked'; reason: 'no-ssh-access' | 'unsupported-platform' }
  | { kind: 'ran'; remote: boolean; result: GrazrRunResult }

const messageOf = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

function failureMessage(failure: GrazrFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return 'The engine timed out.'
    case 'not-deployed':
      return 'Grazr is not installed on this host yet.'
    case 'missing-python':
      return `python3 is not available: ${failure.detail}`
    case 'unreachable':
      return `Could not reach the host: ${failure.detail}`
    case 'engine':
    case 'exit':
      return failure.detail
  }
}

function blockedMessage(reason: 'no-ssh-access' | 'unsupported-platform'): string {
  return reason === 'unsupported-platform'
    ? 'Grazr is not available on this platform.'
    : 'Connect this host over SSH first.'
}

function labelOf(resolved: GrazrResolvedHost): string {
  return resolved.kind === 'ssh' || resolved.kind === 'no-ssh-access' ? resolved.label : LOCAL_LABEL
}

function statusOutcome(result: GrazrRunResult, remote: boolean): GrazrHostOutcome {
  const failure = classifyGrazrOutcome(result, remote)
  if (failure === null) {
    const report = parseGrazrStatusReport(result.stdout)
    return report
      ? { kind: 'ok', report, fetchedAt: Date.now() }
      : { kind: 'engine-error', message: 'The engine printed no status report.' }
  }
  switch (failure.kind) {
    case 'not-deployed':
      return { kind: 'not-deployed' }
    case 'timeout':
    case 'unreachable':
      return { kind: 'unreachable', message: failureMessage(failure) }
    case 'missing-python':
    case 'engine':
    case 'exit':
      return { kind: 'engine-error', message: failureMessage(failure) }
  }
}

function actionResult(invocation: Invocation): GrazrActionResult {
  if (invocation.kind === 'blocked') {
    return { ok: false, message: blockedMessage(invocation.reason) }
  }
  const { result, remote } = invocation
  const failure = classifyGrazrOutcome(result, remote)
  const text = `${result.stdout}\n${result.stderr}`
  if (text.includes(FOREIGN_OWNER)) {
    return {
      ok: false,
      foreignOwner: true,
      message: failure ? failureMessage(failure) : messageOf(result.stdout)
    }
  }
  if (failure) {
    return { ok: false, message: failureMessage(failure) }
  }
  return { ok: true, message: messageOf(result.stdout) }
}

function parseNotices(stdout: string): GrazrNotice[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      const parsed = NoticeSchema.safeParse(JSON.parse(line))
      return parsed.success ? [parsed.data] : []
    } catch {
      return []
    }
  })
}

export function createGrazrService(deps: GrazrServiceDeps): GrazrApi {
  // Why: one host's verbs run in order, so a status never reads the engine mid-swap.
  const queues = new Map<string, Promise<void>>()

  function serial<T>(host: GrazrHostRef, task: () => Promise<T>): Promise<T> {
    const key = grazrHostKey(host)
    const run = (queues.get(key) ?? Promise.resolve()).then(task)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    queues.set(key, tail)
    void tail.then(() => {
      if (queues.get(key) === tail) {
        queues.delete(key)
      }
    })
    return run
  }

  async function execute(
    resolved: GrazrResolvedHost,
    verb: GrazrVerb,
    args: readonly string[],
    timeoutMs: number
  ): Promise<Invocation> {
    switch (resolved.kind) {
      case 'unsupported-platform':
        return { kind: 'blocked', reason: 'unsupported-platform' }
      case 'no-ssh-access':
        return { kind: 'blocked', reason: 'no-ssh-access' }
      case 'local':
        return {
          kind: 'ran',
          remote: false,
          result: await deps.runner.runLocal(verb, args, timeoutMs)
        }
      case 'ssh': {
        const connection = deps.getConnection(resolved.sshTargetId)
        if (!connection) {
          return { kind: 'blocked', reason: 'no-ssh-access' }
        }
        return {
          kind: 'ran',
          remote: true,
          result: await deps.runner.runSsh(connection, verb, args, timeoutMs)
        }
      }
    }
  }

  function action(
    host: GrazrHostRef,
    verb: GrazrVerb,
    args: readonly string[]
  ): Promise<GrazrActionResult> {
    return serial(host, async () =>
      actionResult(await execute(deps.resolve(host), verb, args, ACTION_TIMEOUT_MS))
    )
  }

  async function deploy(resolved: GrazrResolvedHost): Promise<GrazrActionResult> {
    if (resolved.kind === 'unsupported-platform' || resolved.kind === 'no-ssh-access') {
      return { ok: false, message: blockedMessage(resolved.kind) }
    }
    try {
      if (resolved.kind === 'local') {
        await deps.copyDir(deps.engineRoot, join(deps.homedir(), ...ENGINE_DIR_SEGMENTS))
        return { ok: true, message: 'Deployed the engine to this computer.' }
      }
      const connection = deps.getConnection(resolved.sshTargetId)
      if (!connection) {
        return { ok: false, message: blockedMessage('no-ssh-access') }
      }
      // Why: the remote home is resolved first, so no path leaves the host as a literal ~.
      const home = (await deps.execCommand(connection, 'printf %s "$HOME"')).trim()
      const remoteEngine = `${home}/${ENGINE_DIR_SEGMENTS.join('/')}`
      await deps.execCommand(connection, `mkdir -p ${quotePosixShell(remoteEngine)}`)
      await connection.uploadDirectory(deps.engineRoot, remoteEngine)
      return { ok: true, message: 'Deployed the engine to the host.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    status(host) {
      return serial(host, async (): Promise<GrazrHostStatus> => {
        const resolved = deps.resolve(host)
        const invocation = await execute(resolved, 'status', [], STATUS_TIMEOUT_MS)
        const outcome: GrazrHostOutcome =
          invocation.kind === 'blocked'
            ? { kind: invocation.reason }
            : statusOutcome(invocation.result, invocation.remote)
        return { host, label: labelOf(resolved), outcome }
      })
    },
    refresh: (host) => action(host, 'refresh', []),
    swap: (host, name) => action(host, 'swap', name === undefined ? [] : [name]),
    setEnabled: (host, enabled) => action(host, 'set', ['ENABLED', enabled ? '1' : '0']),
    install: (host, force) => action(host, 'install', force ? ['--force'] : []),
    uninstall: (host) => action(host, 'uninstall', []),
    deploy: (host) => serial(host, async () => deploy(deps.resolve(host))),
    async enrolCommand(host) {
      const resolved = deps.resolve(host)
      if (resolved.kind === 'unsupported-platform' || resolved.kind === 'no-ssh-access') {
        return { error: blockedMessage(resolved.kind) }
      }
      const remote = resolved.kind === 'ssh'
      return {
        command: grazrEnrolTerminalCommand(remote, deps.homedir(), deps.platform)
      }
    },
    drainNotices: (host) =>
      serial(host, async () => {
        const invocation = await execute(
          deps.resolve(host),
          'notices-drain',
          [],
          NOTICES_TIMEOUT_MS
        )
        if (invocation.kind === 'blocked') {
          return []
        }
        const { result, remote } = invocation
        return classifyGrazrOutcome(result, remote) === null ? parseNotices(result.stdout) : []
      })
  }
}
