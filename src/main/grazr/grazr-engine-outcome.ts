import type { GrazrRunResult } from './grazr-engine-runner'

export type GrazrFailure = {
  kind: 'timeout' | 'not-deployed' | 'missing-python' | 'unreachable' | 'engine' | 'exit'
  detail: string
}

const ENGINE_PREFIX = 'grazr: '

const lines = (text: string): string[] => text.split('\n')
const firstLine = (text: string): string =>
  lines(text)
    .map((line) => line.trim())
    .find(Boolean) ?? ''
const lastLine = (text: string): string =>
  lines(text)
    .toReversed()
    .map((line) => line.trim())
    .find(Boolean) ?? ''

function engineLine(result: GrazrRunResult): string | null {
  for (const text of [result.stdout, result.stderr]) {
    const line = lines(text).find((candidate) => candidate.startsWith(ENGINE_PREFIX))
    if (line !== undefined) {
      return line.slice(ENGINE_PREFIX.length).trim()
    }
  }
  return null
}

// Ordered by specificity: a timeout hides everything, and an engine line beats a bare exit code.
export function classifyGrazrOutcome(result: GrazrRunResult, remote: boolean): GrazrFailure | null {
  if (result.timedOut) {
    return { kind: 'timeout', detail: 'timed out' }
  }
  if (result.code === 0) {
    return null
  }
  if (result.spawnError?.includes('ENOENT') || result.code === 127) {
    return { kind: 'missing-python', detail: firstLine(result.stderr) || (result.spawnError ?? '') }
  }
  // Other spawn failures (EACCES, EMFILE) have no exit code, so the message is the only detail.
  if (result.spawnError !== null) {
    return { kind: 'exit', detail: result.spawnError }
  }
  if (remote && result.code === 255) {
    return { kind: 'unreachable', detail: lastLine(result.stderr) }
  }
  // Python exits 2 when the engine file is missing, so the host has not had grazr installed yet.
  if (result.code === 2 && /can't open file|No such file/.test(result.stderr)) {
    return { kind: 'not-deployed', detail: lastLine(result.stderr) }
  }
  const engine = engineLine(result)
  if (engine !== null) {
    return { kind: 'engine', detail: engine }
  }
  const status = result.code === null ? 'by signal' : `${result.code}`
  return {
    kind: 'exit',
    detail: `exit ${status}: ${lastLine(result.stderr) || lastLine(result.stdout)}`
  }
}
