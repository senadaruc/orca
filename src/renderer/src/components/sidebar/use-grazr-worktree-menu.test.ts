import { describe, expect, it } from 'vitest'
import {
  parseGrazrStatusReport,
  type GrazrStatusReport
} from '../../../../shared/grazr-status-report'
import {
  grazrActiveEmail,
  grazrConnectionAction,
  grazrHostLabel,
  grazrMenuHostFor,
  grazrSwitchTargets,
  type GrazrLabelState
} from './use-grazr-worktree-menu'

const NOW = new Date('2026-10-21T10:00:00Z')

const session = (remaining: number) => ({
  kind: 'session',
  scope: null,
  group: 'session',
  remaining,
  resets_at: null
})

// a: active; b: parked with room, so next; c: parked but blocked; d: parked and spent; e: in order with no record.
function fixture(): GrazrStatusReport {
  const report = parseGrazrStatusReport(
    JSON.stringify({
      installed: true,
      active: { id: 'a', name: 'a' },
      order: ['a', 'b', 'c', 'd', 'e'],
      settings: { enabled: true, model_limits: false, thresholds: { session: 15, weekly: 20 } },
      accounts: [
        {
          id: 'a',
          name: 'a',
          email: 'a@example.com',
          parked: false,
          in_order: true,
          blocked: null,
          snapshot: [session(42)]
        },
        {
          id: 'b',
          name: 'b',
          email: 'b@example.com',
          parked: true,
          in_order: true,
          blocked: null,
          snapshot: [session(80)]
        },
        {
          id: 'c',
          name: 'c',
          email: 'c@example.com',
          parked: true,
          in_order: true,
          blocked: 'payment',
          snapshot: [session(90)]
        },
        {
          id: 'd',
          name: 'd',
          email: 'd@example.com',
          parked: true,
          in_order: true,
          blocked: null,
          snapshot: [session(5)]
        }
      ]
    })
  )
  if (report === null) {
    throw new Error('fixture is not a status report')
  }
  return report
}

describe('grazrMenuHostFor', () => {
  it('maps a local, ssh or runtime owner to its host ref', () => {
    expect(grazrMenuHostFor('local', 'darwin')).toEqual({ kind: 'local' })
    expect(grazrMenuHostFor('ssh:box', 'linux')).toEqual({ kind: 'ssh', sshTargetId: 'box' })
    expect(grazrMenuHostFor('runtime:env1', 'win32')).toEqual({
      kind: 'environment',
      environmentId: 'env1'
    })
  })

  it('hides the submenu for a local Windows host', () => {
    expect(grazrMenuHostFor('local', 'win32')).toBeNull()
  })
})

describe('grazrHostLabel', () => {
  const state: GrazrLabelState = {
    runtimeEnvironments: [{ id: 'env1', name: 'Lab box' }],
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map([['build', 'Build server']]),
    removedSshTargetLabels: new Map(),
    sshTargetsHydrated: true,
    sshStateByEnvironment: new Map()
  }

  it('names an ssh host by its saved target label', () => {
    expect(grazrHostLabel({ kind: 'ssh', sshTargetId: 'build' }, state)).toBe('Build server')
  })

  it('falls back to the ssh target id when no label is saved', () => {
    expect(grazrHostLabel({ kind: 'ssh', sshTargetId: 'other' }, state)).toBe('other')
  })

  it('names an environment by its name and falls back to its id', () => {
    expect(grazrHostLabel({ kind: 'environment', environmentId: 'env1' }, state)).toBe('Lab box')
    expect(grazrHostLabel({ kind: 'environment', environmentId: 'env9' }, state)).toBe('env9')
  })
})

describe('grazrConnectionAction', () => {
  it('offers disconnect when the status line is installed', () => {
    expect(grazrConnectionAction(true)).toBe('disconnect')
  })

  it('offers connect when the status line is not installed', () => {
    expect(grazrConnectionAction(false)).toBe('connect')
  })

  it('offers neither when the engine does not say', () => {
    expect(grazrConnectionAction(null)).toBeNull()
  })
})

describe('grazrSwitchTargets', () => {
  it('lists parked, non-blocked accounts and leaves out the active and blocked ones', () => {
    expect(grazrSwitchTargets(fixture(), NOW)).toEqual([
      { name: 'b', isNext: true },
      { name: 'd', isNext: false }
    ])
  })
})

describe('grazrActiveEmail', () => {
  it('returns the active account email', () => {
    expect(grazrActiveEmail(fixture(), NOW)).toBe('a@example.com')
  })

  it('returns null when nobody is logged in', () => {
    const report = parseGrazrStatusReport(
      JSON.stringify({ active: null, order: [], accounts: [], settings: {} })
    )
    if (report === null) {
      throw new Error('fixture is not a status report')
    }
    expect(grazrActiveEmail(report, NOW)).toBeNull()
  })
})
