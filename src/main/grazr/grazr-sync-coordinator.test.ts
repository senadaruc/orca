import { describe, expect, it } from 'vitest'
import type { GrazrActionResult, GrazrHostStatus } from '../../shared/grazr-api-types'
import type { GrazrHostRef } from '../../shared/grazr-host'
import type { GrazrStatusReport } from '../../shared/grazr-status-report'
import type { GrazrSyncSnapshot } from '../../shared/grazr-sync-types'
import { GrazrSyncCoordinator, type GrazrSyncSaved } from './grazr-sync-coordinator'
import type { GrazrSyncDeviceRef } from './grazr-sync-devices'

const ACCOUNTS: [string, string][] = [
  ['g', 'gmail'],
  ['i', 'icloud']
]

// A host's engine as the sync sees it: its order and active account, which swap and set change.
type FakeHost = { order: string[]; active: string; changedAt: number; setRefusal?: string }

function reportOf(host: FakeHost): GrazrStatusReport {
  return {
    version: '0.4.7+fork.13',
    installed: true,
    managed_profile: false,
    connection: { statusline: null, failure_hook: null, foreign: null },
    active: { id: host.active, name: ACCOUNTS.find(([id]) => id === host.active)?.[1] ?? '' },
    accounts: ACCOUNTS.map(([id, name]) => ({
      id,
      name,
      email: null,
      organization: null,
      plan: null,
      updated: null,
      unused_reset: null,
      parked: true,
      in_order: true,
      first_reading_due: false,
      blocked: null,
      snapshot: []
    })),
    order: host.order,
    changed_at: host.changedAt,
    settings: { enabled: true, model_limits: false, thresholds: { session: 20, weekly: 20 } }
  }
}

const keyOf = (host: GrazrHostRef): string => (host.kind === 'ssh' ? host.sshTargetId : 'local')

function harness(hosts: Record<string, FakeHost>, saved: GrazrSyncSaved | null = null) {
  let clock = 10_000
  const timers: (() => void)[] = []
  const commands: string[] = []
  const notices: string[] = []
  const broadcasts: GrazrSyncSnapshot[] = []
  let stored = saved
  const devices: GrazrSyncDeviceRef[] = Object.keys(hosts).map((key) => ({
    key,
    name: key,
    host: key === 'local' ? { kind: 'local' } : { kind: 'ssh', sshTargetId: key }
  }))
  const ok = (message: string): GrazrActionResult => ({ ok: true, message })
  const coordinator = new GrazrSyncCoordinator({
    grazr: {
      status: (host): Promise<GrazrHostStatus> => {
        const fake = hosts[keyOf(host)]
        return Promise.resolve({
          host,
          label: keyOf(host),
          outcome: fake
            ? { kind: 'ok', report: reportOf(fake), fetchedAt: 0 }
            : { kind: 'unreachable', message: 'down' },
          engineOutdated: false,
          bundledEngineVersion: null
        })
      },
      setAccounts: (host, names) => {
        const fake = hosts[keyOf(host)]
        commands.push(`${keyOf(host)}: set ACCOUNTS ${names.join(' ')}`)
        if (fake?.setRefusal) {
          return Promise.resolve({ ok: false, message: fake.setRefusal })
        }
        if (fake) {
          fake.order = [...names]
          fake.changedAt = clock
        }
        return Promise.resolve(ok(`ACCOUNTS=${names.join(' ')}`))
      },
      swap: (host, name) => {
        const fake = hosts[keyOf(host)]
        commands.push(`${keyOf(host)}: swap ${name ?? ''}`)
        const id = ACCOUNTS.find(([, n]) => n === name)?.[0]
        if (fake && id !== undefined) {
          fake.active = id
          fake.changedAt = clock
        }
        return Promise.resolve(ok(`Rotated to ${name ?? ''}`))
      }
    },
    listDevices: () => devices,
    now: () => clock,
    intervalMs: 60_000,
    setTimer: (fn) => {
      timers.push(fn)
      return () => undefined
    },
    load: () => Promise.resolve(stored),
    save: (next) => {
      stored = next
      return Promise.resolve()
    },
    notify: (title, body) => {
      notices.push(`${title} · ${body}`)
    },
    broadcast: (snapshot) => {
      broadcasts.push(snapshot)
    }
  })
  return {
    coordinator,
    commands,
    notices,
    broadcasts,
    timers,
    stored: () => stored,
    advance: (seconds: number) => {
      clock += seconds
    }
  }
}

describe('GrazrSyncCoordinator', () => {
  it('previews the first round and pushes only on Apply, then reports who follows whom', async () => {
    const h = harness({
      local: { order: ['gmail', 'icloud'], active: 'g', changedAt: 1000 },
      dev: { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }
    })
    h.coordinator.setEnabled(true)
    await h.coordinator.pendingRound
    const preview = h.coordinator.snapshot()
    expect(preview.applied).toBe(false)
    expect(preview.status).toMatchObject({ kind: 'preview', moves: 1 })
    expect(preview.status.kind === 'preview' && preview.status.lines.map((l) => l.text)).toEqual([
      "local will move to icloud and take dev's order"
    ])
    expect(h.commands).toEqual([])
    expect(preview.devices.map((d) => [d.key, d.runsGrazr, d.included])).toEqual([
      ['local', true, true],
      ['dev', true, true]
    ])

    h.coordinator.apply()
    await h.coordinator.pendingRound
    expect(h.commands).toEqual(['local: set ACCOUNTS icloud gmail', 'local: swap icloud'])
    expect(h.notices).toEqual(['grazr: local now on icloud · following dev'])
    const after = h.coordinator.snapshot()
    expect(after.applied).toBe(true)
    expect(after.status.kind === 'lines' && after.status.lines.map((l) => l.text)).toEqual([
      'local follows dev (changed 2 hr. ago)'
    ])
    expect(h.stored()).toMatchObject({ enabled: true, applied: true, excluded: [] })
    expect(h.stored()?.planner?.target?.source).toBe('dev')
    // The loop is armed for the next minute.
    expect(h.timers.length).toBe(1)
  })

  it('starts at once when nothing would move, and says so', async () => {
    const h = harness({
      local: { order: ['gmail', 'icloud'], active: 'g', changedAt: 1000 },
      dev: { order: ['gmail', 'icloud'], active: 'g', changedAt: 1000 }
    })
    h.coordinator.setEnabled(true)
    await h.coordinator.pendingRound
    const snapshot = h.coordinator.snapshot()
    expect(snapshot.applied).toBe(true)
    expect(snapshot.status.kind === 'lines' && snapshot.status.lines.map((l) => l.text)).toEqual([
      'All devices in sync'
    ])
    expect(h.commands).toEqual([])
  })

  it('waits for a second device and names the one it has', async () => {
    const h = harness({ local: { order: ['gmail'], active: 'g', changedAt: 1 }, dev: undefined! })
    h.coordinator.setEnabled(true)
    await h.coordinator.pendingRound
    expect(h.coordinator.snapshot().status).toEqual({ kind: 'few-devices', name: 'local' })
  })

  it('reports an engine that cannot set ACCOUNTS as needing an update', async () => {
    const h = harness({
      local: {
        order: ['gmail', 'icloud'],
        active: 'i',
        changedAt: 1000,
        setRefusal: 'exit 1: grazr: only ENABLED, MODEL_LIMITS can be set this way'
      },
      dev: { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }
    })
    h.coordinator.setEnabled(true)
    await h.coordinator.pendingRound
    h.coordinator.apply()
    await h.coordinator.pendingRound
    const snapshot = h.coordinator.snapshot()
    expect(snapshot.status.kind === 'lines' && snapshot.status.lines.map((l) => l.text)).toEqual([
      'grazr on local needs 0.4.7+senad.4 or later'
    ])
  })

  it('leaves an excluded device unread and unpushed, and off forgets everything', async () => {
    const h = harness({
      local: { order: ['gmail', 'icloud'], active: 'g', changedAt: 1000 },
      dev: { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }
    })
    h.coordinator.setIncluded('local', false)
    h.coordinator.setEnabled(true)
    await h.coordinator.pendingRound
    expect(h.coordinator.snapshot().status).toEqual({ kind: 'few-devices', name: 'dev' })
    expect(h.stored()?.excluded).toEqual(['local'])

    h.coordinator.setEnabled(false)
    expect(h.coordinator.snapshot()).toMatchObject({ enabled: false, status: { kind: 'off' } })
    expect(h.broadcasts.at(-1)?.status).toEqual({ kind: 'off' })
  })

  it('carries on from the saved state after a restart without a new preview', async () => {
    const first = harness({
      local: { order: ['gmail', 'icloud'], active: 'g', changedAt: 1000 },
      dev: { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }
    })
    first.coordinator.setEnabled(true)
    await first.coordinator.pendingRound
    first.coordinator.apply()
    await first.coordinator.pendingRound

    const second = harness(
      {
        local: { order: ['icloud', 'gmail'], active: 'i', changedAt: 10_000 },
        dev: { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }
      },
      first.stored()
    )
    await second.coordinator.start()
    await second.coordinator.pendingRound
    const snapshot = second.coordinator.snapshot()
    expect(snapshot).toMatchObject({ enabled: true, applied: true })
    expect(snapshot.status.kind).toBe('lines')
    expect(second.commands).toEqual([])
  })
})
