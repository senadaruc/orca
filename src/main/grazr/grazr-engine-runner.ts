import type { runProcess } from '@orca/process-host'
import type { SshConnection } from '../ssh/connection/ssh-connection'
import type { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { isSshCommandExitError, isSshExecTimeout } from '../ssh/remote-exec/remote-exec-command'
import { grazrLocalInvocation, grazrRemoteCommand, type GrazrVerb } from './grazr-engine-command'

export type GrazrRunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError: string | null
}

// The narrow shape the engine needs: command execution plus the engine upload.
export type GrazrSshConnection = Parameters<typeof execCommand>[0] &
  Pick<SshConnection, 'uploadDirectory'>

export type GrazrEngineRunner = {
  runLocal(verb: GrazrVerb, args: readonly string[], timeoutMs: number): Promise<GrazrRunResult>
  runSsh(
    connection: GrazrSshConnection,
    verb: GrazrVerb,
    args: readonly string[],
    timeoutMs: number
  ): Promise<GrazrRunResult>
}

export type GrazrEngineRunnerDeps = {
  runProcess: typeof runProcess
  execCommand: typeof execCommand
  homedir: () => string
  platform: NodeJS.Platform
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Drops the echoed command, which carries the account name, and keeps only the remote output.
const EXIT_ERROR_PREFIX = /^Command ".*?" failed \(exit -?\d+\): /
const commandOutput = (message: string): string => message.replace(EXIT_ERROR_PREFIX, '')

const NO_OUTPUT: Pick<GrazrRunResult, 'stdout' | 'stderr' | 'timedOut' | 'spawnError'> = {
  stdout: '',
  stderr: '',
  timedOut: false,
  spawnError: null
}

export function createGrazrEngineRunner(deps: GrazrEngineRunnerDeps): GrazrEngineRunner {
  return {
    async runLocal(verb, args, timeoutMs) {
      const invocation = grazrLocalInvocation(verb, args, deps.homedir(), deps.platform)
      try {
        // The engine needs PATH and HOME, so the GRAZR variables are layered over the parent env.
        const result = await deps.runProcess({
          program: invocation.program,
          args: invocation.args,
          env: { ...process.env, ...invocation.env },
          timeoutMs
        })
        return {
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          spawnError: null
        }
      } catch (error) {
        return { ...NO_OUTPUT, code: null, spawnError: describeError(error) }
      }
    },

    async runSsh(connection, verb, args, timeoutMs) {
      try {
        const stdout = await deps.execCommand(connection, grazrRemoteCommand(verb, args), {
          timeoutMs
        })
        return { ...NO_OUTPUT, code: 0, stdout }
      } catch (error) {
        if (isSshExecTimeout(error)) {
          return { ...NO_OUTPUT, code: null, timedOut: true }
        }
        if (isSshCommandExitError(error)) {
          return {
            ...NO_OUTPUT,
            code: error.exitCode,
            stdout: error.stdout,
            stderr: commandOutput(error.message)
          }
        }
        return { ...NO_OUTPUT, code: null, spawnError: describeError(error) }
      }
    }
  }
}
