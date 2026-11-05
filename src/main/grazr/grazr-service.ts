import { join } from 'node:path'
import { translateMain } from '../i18n/main-i18n'
import type {
  GrazrApi,
  GrazrActionResult,
  GrazrHostOutcome,
  GrazrHostStatus
} from '../../shared/grazr-api-types'
import { grazrHostKey, type GrazrHostRef } from '../../shared/grazr-host'
import { parseGrazrStatusReport } from '../../shared/grazr-status-report'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { grazrEnrolTerminalCommand, type GrazrVerb } from './grazr-engine-command'
import { classifyGrazrOutcome, type GrazrFailure } from './grazr-engine-outcome'
import { parseGrazrNotices } from './grazr-engine-notices'
import { cachedBundledVersion, isEngineOutdated } from './grazr-engine-version'
import type { GrazrEngineRunner, GrazrRunResult, GrazrSshConnection } from './grazr-engine-runner'
import type { GrazrResolvedHost } from './grazr-host-resolver'

export type GrazrServiceDeps = {
  runner: GrazrEngineRunner
  resolve: (host: GrazrHostRef) => GrazrResolvedHost
  getConnection: (sshTargetId: string) => GrazrSshConnection | undefined
  execCommand: (
    connection: GrazrSshConnection,
    command: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>
  resolveEngineRoot: () => string
  readEngineVersion: (engineRoot: string) => Promise<string>
  copyDir: (from: string, to: string) => Promise<void>
  homedir: () => string
  platform: NodeJS.Platform
}

const VERB_TIMEOUT_MS: Record<GrazrVerb, number> = {
  status: 10_000,
  refresh: 10_000,
  swap: 10_000,
  set: 10_000,
  install: 20_000,
  uninstall: 20_000,
  'notices-drain': 10_000
}
const DEPLOY_TIMEOUT_MS = 60_000
const FOREIGN_OWNER = 'already belongs'
const ENGINE_DIR_SEGMENTS = ['.local', 'share', 'orca-grazr', 'engine']

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
      return translateMain('grazr.main.timedOut', 'The engine timed out.')
    case 'not-deployed':
      return translateMain('grazr.main.notInstalled', 'Grazr is not installed on this host yet.')
    case 'missing-python':
      return translateMain('grazr.main.pythonMissing', 'python3 is not available: {{detail}}', {
        detail: failure.detail
      })
    case 'unreachable':
      return translateMain('grazr.main.unreachable', 'Could not reach the host: {{detail}}', {
        detail: failure.detail
      })
    case 'engine':
    case 'exit':
      return failure.detail
  }
}

function blockedMessage(reason: 'no-ssh-access' | 'unsupported-platform'): string {
  return reason === 'unsupported-platform'
    ? translateMain('grazr.main.unsupportedPlatform', 'Grazr is not available on this platform.')
    : translateMain('grazr.main.noSshAccess', 'Connect this host over SSH first.')
}

function labelOf(resolved: GrazrResolvedHost): string {
  return resolved.kind === 'ssh' || resolved.kind === 'no-ssh-access'
    ? resolved.label
    : translateMain('grazr.main.thisComputer', 'This computer')
}

function statusOutcome(result: GrazrRunResult, remote: boolean): GrazrHostOutcome {
  const failure = classifyGrazrOutcome(result, remote)
  if (failure === null) {
    const report = parseGrazrStatusReport(result.stdout)
    return report
      ? { kind: 'ok', report, fetchedAt: Date.now() }
      : {
          kind: 'engine-error',
          message: translateMain(
            'grazr.main.noStatusReport',
            'The engine printed no status report.'
          )
        }
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
  if (failure === null) {
    return { ok: true, message: messageOf(result.stdout) }
  }
  return {
    ok: false,
    foreignOwner: `${result.stdout}\n${result.stderr}`.includes(FOREIGN_OWNER),
    message: failureMessage(failure)
  }
}

export function createGrazrService(deps: GrazrServiceDeps): GrazrApi {
  // Why: one host's verbs run in order, so a status never reads the engine mid-swap.
  const queues = new Map<string, Promise<void>>()
  // Why: resolving the root reads the Electron app, so it waits for the first status or deploy.
  let engineRoot: string | null = null
  const currentEngineRoot = (): string => (engineRoot ??= deps.resolveEngineRoot())
  const readBundledVersion = cachedBundledVersion(() => deps.readEngineVersion(currentEngineRoot()))

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
    args: readonly string[]
  ): Promise<Invocation> {
    const timeoutMs = VERB_TIMEOUT_MS[verb]
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
    return serial(host, async () => actionResult(await execute(deps.resolve(host), verb, args)))
  }

  // Why: the race bounds the whole deploy, so a hung upload cannot hold this host's queue.
  async function deploy(resolved: GrazrResolvedHost): Promise<GrazrActionResult> {
    if (resolved.kind === 'unsupported-platform' || resolved.kind === 'no-ssh-access') {
      return { ok: false, message: blockedMessage(resolved.kind) }
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<GrazrActionResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve({
          ok: false,
          message: translateMain('grazr.main.deployTimedOut', 'Deploying the engine timed out.')
        })
      }, DEPLOY_TIMEOUT_MS)
    })
    try {
      return await Promise.race([deployWithin(resolved, controller.signal), expired])
    } finally {
      clearTimeout(timer)
    }
  }

  async function deployWithin(
    resolved: GrazrResolvedHost,
    signal: AbortSignal
  ): Promise<GrazrActionResult> {
    try {
      if (resolved.kind === 'local') {
        await deps.copyDir(currentEngineRoot(), join(deps.homedir(), ...ENGINE_DIR_SEGMENTS))
        return {
          ok: true,
          message: translateMain(
            'grazr.main.deployedLocal',
            'Deployed the engine to this computer.'
          )
        }
      }
      if (resolved.kind !== 'ssh') {
        return { ok: false, message: blockedMessage('no-ssh-access') }
      }
      const connection = deps.getConnection(resolved.sshTargetId)
      if (!connection) {
        return { ok: false, message: blockedMessage('no-ssh-access') }
      }
      // Why: the remote home is resolved first, so no path leaves the host as a literal ~.
      const home = (
        await deps.execCommand(connection, 'printf %s "$HOME"', { timeoutMs: DEPLOY_TIMEOUT_MS })
      ).trim()
      if (!home.startsWith('/')) {
        return {
          ok: false,
          message: translateMain(
            'grazr.main.homeUnresolved',
            'Could not resolve the remote home directory.'
          )
        }
      }
      const remoteEngine = `${home}/${ENGINE_DIR_SEGMENTS.join('/')}`
      await deps.execCommand(connection, `mkdir -p ${quotePosixShell(remoteEngine)}`, {
        timeoutMs: DEPLOY_TIMEOUT_MS
      })
      await connection.uploadDirectory(currentEngineRoot(), remoteEngine, { signal })
      return {
        ok: true,
        message: translateMain('grazr.main.deployedHost', 'Deployed the engine to the host.')
      }
    } catch (error) {
      // Why: a failed remote command carries its exit status and output in the message.
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    status(host) {
      return serial(host, async (): Promise<GrazrHostStatus> => {
        const resolved = deps.resolve(host)
        const invocation = await execute(resolved, 'status', [])
        const outcome: GrazrHostOutcome =
          invocation.kind === 'blocked'
            ? { kind: invocation.reason }
            : statusOutcome(invocation.result, invocation.remote)
        const bundled = outcome.kind === 'ok' ? await readBundledVersion() : null
        return {
          host,
          label: labelOf(resolved),
          outcome,
          engineOutdated: isEngineOutdated(outcome, bundled),
          bundledEngineVersion: bundled
        }
      })
    },
    refresh: (host) => action(host, 'refresh', []),
    swap: (host, name) => action(host, 'swap', name === undefined ? [] : [name]),
    setEnabled: (host, enabled) => action(host, 'set', ['ENABLED', enabled ? '1' : '0']),
    setAccounts: (host, names) => action(host, 'set', ['ACCOUNTS', names.join(' ')]),
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
        const invocation = await execute(deps.resolve(host), 'notices-drain', [])
        if (invocation.kind === 'blocked') {
          return []
        }
        const { result, remote } = invocation
        return classifyGrazrOutcome(result, remote) === null ? parseGrazrNotices(result.stdout) : []
      })
  }
}
