import { describe, expect, it } from 'vitest'
import { classifyGrazrOutcome } from './grazr-engine-outcome'
import type { GrazrRunResult } from './grazr-engine-runner'

const ok: GrazrRunResult = {
  code: 0,
  stdout: '{}',
  stderr: '',
  timedOut: false,
  spawnError: null
}

describe('classifyGrazrOutcome', () => {
  it('returns null for a clean exit', () => {
    expect(classifyGrazrOutcome(ok, false)).toBeNull()
  })

  it('reports a timeout before anything else', () => {
    const result = { ...ok, code: null, stderr: 'grazr: stale', timedOut: true }
    expect(classifyGrazrOutcome(result, true)).toEqual({ kind: 'timeout', detail: 'timed out' })
  })

  it('reports a missing python3 when the spawn fails with ENOENT', () => {
    const result = { ...ok, code: null, spawnError: 'spawn python3 ENOENT' }
    expect(classifyGrazrOutcome(result, false)).toEqual({
      kind: 'missing-python',
      detail: 'spawn python3 ENOENT'
    })
  })

  it('reports a missing python3 when the shell exits 127', () => {
    const result = { ...ok, code: 127, stderr: 'sh: python3: command not found\n' }
    expect(classifyGrazrOutcome(result, true)).toEqual({
      kind: 'missing-python',
      detail: 'sh: python3: command not found'
    })
  })

  it('reports other spawn failures with their message as an exit', () => {
    const result = { ...ok, code: null, spawnError: 'spawn EACCES' }
    expect(classifyGrazrOutcome(result, false)).toEqual({ kind: 'exit', detail: 'spawn EACCES' })
  })

  it('reports an unreachable host for ssh exit 255 with the last stderr line', () => {
    const result = {
      ...ok,
      code: 255,
      stderr: 'Warning: noise\nssh: connect to host cloud-dev port 22: Operation timed out\n'
    }
    expect(classifyGrazrOutcome(result, true)).toEqual({
      kind: 'unreachable',
      detail: 'ssh: connect to host cloud-dev port 22: Operation timed out'
    })
  })

  it('treats exit 255 locally as a plain exit', () => {
    const result = { ...ok, code: 255, stderr: 'boom' }
    expect(classifyGrazrOutcome(result, false)).toEqual({ kind: 'exit', detail: 'exit 255: boom' })
  })

  it('reports a host without the engine when python cannot open the file', () => {
    const result = {
      ...ok,
      code: 2,
      stderr:
        "python3: can't open file '/home/a/.local/share/orca-grazr/engine/grazr.py': [Errno 2] No such file or directory\n"
    }
    expect(classifyGrazrOutcome(result, true)).toEqual({
      kind: 'not-deployed',
      detail:
        "python3: can't open file '/home/a/.local/share/orca-grazr/engine/grazr.py': [Errno 2] No such file or directory"
    })
  })

  it('returns the engine error line, found on stdout or stderr', () => {
    const result = {
      ...ok,
      code: 1,
      stdout: 'Traceback (most recent call last):\n',
      stderr: 'noise\ngrazr: account "work" is not enrolled\n'
    }
    expect(classifyGrazrOutcome(result, false)).toEqual({
      kind: 'engine',
      detail: 'account "work" is not enrolled'
    })
  })

  it('falls back to the exit code with the last line of output', () => {
    const result = { ...ok, code: 3, stdout: 'first\nlast words\n', stderr: '' }
    expect(classifyGrazrOutcome(result, false)).toEqual({
      kind: 'exit',
      detail: 'exit 3: last words'
    })
  })
})
