import { describe, expect, it } from 'vitest'
import { parseGrazrStatusReport, type GrazrStatusReport } from './grazr-status-report'
import {
  buildGrazrRotationView,
  centre,
  modelScopes,
  nextAccount,
  orderedAccounts,
  relativeAge,
  rowState,
  windowBars,
  windowOf,
  type GrazrRotationRow
} from './grazr-rotation-view'
import { grazrHostChip } from './grazr-host-chip'
import type { GrazrHostOutcome } from './grazr-api-types'

const ZONE = 'Europe/Zurich'
const NOW = new Date('2026-10-21T10:00:00Z')
const at = { timeZone: ZONE, now: NOW }
const thresholds = { session: 15, weekly: 20 }

// The entries the engine reports: the 5h window is group session, the weekly one group weekly, both account-wide (scope null).
const session = (remaining: number, resets_at: string | null = null) => ({
  kind: 'session',
  scope: null,
  group: 'session',
  remaining,
  resets_at
})
const weekly = (remaining: number, resets_at: string | null = null) => ({
  kind: 'weekly_all',
  scope: null,
  group: 'weekly',
  remaining,
  resets_at
})

function parseReport(value: unknown): GrazrStatusReport {
  const report = parseGrazrStatusReport(JSON.stringify(value))
  if (report === null) {
    throw new Error('fixture is not a status report')
  }
  return report
}

// a: active, 42.01 session and 70 weekly; b: parked and full; c: parked and spent on session; d: blocked, never read.
const fixture = () =>
  parseReport({
    active: { id: 'a', name: 'a', enrolled: true, in_order: true },
    order: ['a', 'b', 'c', 'd'],
    settings: { enabled: true, thresholds: { ...thresholds } },
    accounts: [
      {
        id: 'a',
        name: 'a',
        email: 'a@example.com',
        parked: false,
        in_order: true,
        blocked: null,
        first_reading_due: false,
        snapshot: [
          session(42.01, '2026-10-21T18:00:00+02:00'),
          weekly(70, '2026-10-27T09:00:00+02:00')
        ]
      },
      {
        id: 'b',
        name: 'b',
        email: 'b@example.com',
        parked: true,
        in_order: true,
        blocked: null,
        first_reading_due: false,
        snapshot: [session(100), weekly(100)]
      },
      {
        id: 'c',
        name: 'c',
        email: 'c@example.com',
        parked: true,
        in_order: true,
        blocked: null,
        first_reading_due: false,
        snapshot: [session(5, '2026-10-24T13:00:00+02:00'), weekly(50, '2026-10-27T09:00:00+02:00')]
      },
      {
        id: 'd',
        name: 'd',
        email: 'd@example.com',
        parked: true,
        in_order: true,
        blocked: 'authentication_failed',
        first_reading_due: false,
        snapshot: null
      }
    ]
  })

function accountNamed(report: GrazrStatusReport, name: string) {
  const found = report.accounts.find((a) => a.name === name)
  if (found === undefined) {
    throw new Error(`no account named ${name}`)
  }
  return found
}

// A small report: every account parked and full unless the test changes it.
const account = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  parked: true,
  blocked: null,
  snapshot: [session(100), weekly(100)],
  ...extra
})
const reportOf = ({
  order,
  active,
  accounts,
  thresholds: t = thresholds
}: {
  order: string[]
  active: string | null
  accounts: unknown[]
  thresholds?: { session: number; weekly: number }
}) =>
  parseReport({
    active: active === null ? null : { id: active, name: active },
    order,
    settings: { enabled: true, thresholds: t },
    accounts
  })

const ok = (value: unknown): GrazrHostOutcome => ({
  kind: 'ok',
  report: parseReport(value),
  fetchedAt: NOW.getTime()
})

describe('windowOf and shortfall', () => {
  it('picks the account-wide entry of each group', () => {
    const snapshot = fixture().accounts[0]?.snapshot ?? null
    expect(windowOf(snapshot, 'session', NOW)).toEqual({
      remaining: 42.01,
      resets_at: '2026-10-21T18:00:00+02:00'
    })
    expect(windowOf(snapshot, 'weekly', NOW)).toEqual({
      remaining: 70,
      resets_at: '2026-10-27T09:00:00+02:00'
    })
    expect(windowOf(null, 'session', NOW)).toBeNull()
  })

  it('reads a non-numeric remaining as absent', () => {
    const report = parseReport({
      accounts: [
        {
          id: 'a',
          name: 'a',
          snapshot: [{ kind: 'weekly_all', scope: null, group: 'weekly', remaining: 'lots' }]
        }
      ]
    })
    expect(windowOf(accountNamed(report, 'a').snapshot, 'weekly', NOW)).toBeNull()
  })

  it('never shows a per-model weekly entry, even when it is listed first', () => {
    const snapshot = parseReport({
      accounts: [
        {
          id: 'a',
          name: 'a',
          snapshot: [
            {
              kind: 'weekly_scoped',
              scope: 'Fable',
              group: 'weekly',
              remaining: 3,
              resets_at: '2026-10-27T09:00:00+02:00'
            },
            weekly(70, '2026-10-27T09:00:00+02:00')
          ]
        }
      ]
    })
    const entries = accountNamed(snapshot, 'a').snapshot
    expect(windowOf(entries, 'weekly', NOW)).toEqual({
      remaining: 70,
      resets_at: '2026-10-27T09:00:00+02:00'
    })
    const scopedOnly = entries?.slice(0, 1) ?? null
    expect(windowOf(scopedOnly, 'weekly', NOW)).toBeNull()
  })

  it('treats a window whose reset is at or before now as absent, as the engine does', () => {
    expect(windowOf([session(40, '2026-10-21T09:00:00Z')], 'session', NOW)).toBeNull()
    expect(windowOf([session(40, NOW.toISOString())], 'session', NOW)).toBeNull()
    expect(windowOf([session(40, '2026-10-21T11:00:00Z')], 'session', NOW)?.remaining).toBe(40)
    expect(windowOf([session(40, null)], 'session', NOW)?.remaining).toBe(40)
  })

  it('an expired window reads as not read yet and never makes its account spent', () => {
    const report = fixture()
    accountNamed(report, 'c').snapshot = [
      session(5, '2026-10-21T09:00:00Z'),
      weekly(50, '2026-10-27T09:00:00+02:00')
    ]
    expect(rowState(accountNamed(report, 'c'), report, 'session', at)).toEqual({
      percent: null,
      status: 'unread',
      label: 'not read yet'
    })
    expect(nextAccount(report, NOW)?.name).toBe('b')
  })
})

describe('nextAccount', () => {
  it('is the first eligible account after the active one, in order, with no wrap', () => {
    const report = fixture()
    expect(nextAccount(report, NOW)?.name).toBe('b')

    const bSpent = fixture()
    accountNamed(bSpent, 'b').snapshot = [session(3), weekly(100)]
    expect(nextAccount(bSpent, NOW)).toBeNull()
  })

  it('takes the first eligible in order, not the one after the active one, and does not wrap', () => {
    // The case that differed from the engine: active b, a and c both fine; the engine swaps to a, not to c.
    const report = reportOf({
      order: ['a', 'b', 'c'],
      active: 'b',
      accounts: [account('a'), account('b'), account('c')]
    })
    expect(nextAccount(report, NOW)?.name).toBe('a')
  })

  it('with an order set never picks an unordered account', () => {
    // The engine only sees ordered accounts when ACCOUNTS is set, so an unordered z is never next.
    const report = reportOf({
      order: ['a'],
      active: 'a',
      accounts: [account('a'), account('z')]
    })
    expect(nextAccount(report, NOW)).toBeNull()
  })

  it('with no order picks the first eligible account in the report', () => {
    const report = reportOf({
      order: [],
      active: 'b',
      accounts: [account('a'), account('b'), account('z')]
    })
    expect(nextAccount(report, NOW)?.name).toBe('a')
  })

  it('treats an exact threshold as headroom: remaining below it fails, equal passes', () => {
    const t = { session: 15, weekly: 10 }
    const atThreshold = reportOf({
      order: ['a', 'b'],
      active: 'a',
      thresholds: t,
      accounts: [account('a'), account('b', { snapshot: [session(15), weekly(10)] })]
    })
    expect(nextAccount(atThreshold, NOW)?.name).toBe('b')
    const below = reportOf({
      order: ['a', 'b'],
      active: 'a',
      thresholds: t,
      accounts: [account('a'), account('b', { snapshot: [session(14.99), weekly(10)] })]
    })
    expect(nextAccount(below, NOW)).toBeNull()
  })

  it('skips an account whose per-model weekly window is below its threshold when model limits are on', () => {
    const report = reportOf({
      order: ['a', 'b', 'c'],
      active: 'a',
      accounts: [
        account('a'),
        account('b', {
          snapshot: [
            session(100),
            weekly(100),
            {
              kind: 'weekly_scoped',
              scope: 'Fable',
              group: 'weekly',
              remaining: 3,
              resets_at: null
            }
          ]
        }),
        account('c')
      ]
    })
    report.settings.model_limits = true
    expect(nextAccount(report, NOW)?.name).toBe('c')
  })

  it('ignores a leftover per-model weekly window when model limits are off', () => {
    // The reviewer's probe: b is at 90% on both account-wide windows, with a stale per-model weekly at 3%.
    const probe = () =>
      reportOf({
        order: ['a', 'b'],
        active: 'a',
        accounts: [
          account('a'),
          account('b', {
            snapshot: [
              session(90),
              weekly(90),
              {
                kind: 'weekly_scoped',
                scope: 'Fable',
                group: 'weekly',
                remaining: 3,
                resets_at: null
              }
            ]
          })
        ]
      })
    const off = probe()
    off.settings.model_limits = false
    expect(nextAccount(off, NOW)?.name).toBe('b')
    expect(rowState(accountNamed(off, 'b'), off, 'session', { now: NOW }).status).toBe('next')
    // With model limits on, the same stale window makes b spent, so it is not next.
    const on = probe()
    on.settings.model_limits = true
    expect(nextAccount(on, NOW)).toBeNull()
    expect(rowState(accountNamed(on, 'b'), on, 'session', { now: NOW }).status).toBe('spent')
  })

  it('is null when nobody is logged in or the active account is unknown', () => {
    const none = fixture()
    none.active = null
    expect(nextAccount(none, NOW)).toBeNull()
    const unknown = fixture()
    unknown.active = { id: 'zz', name: 'zz' }
    expect(nextAccount(unknown, NOW)).toBeNull()
  })
})

describe('rowState', () => {
  it('is active, NEXT, spent with its reset, blocked, not enrolled, or not read yet', () => {
    const report = fixture()
    expect(rowState(accountNamed(report, 'a'), report, 'session', at)).toEqual({
      percent: 42,
      status: 'active',
      label: 'active'
    })
    expect(rowState(accountNamed(report, 'b'), report, 'session', at)).toEqual({
      percent: 100,
      status: 'next',
      label: 'NEXT ▸'
    })
    expect(rowState(accountNamed(report, 'c'), report, 'session', at)).toEqual({
      percent: 5,
      status: 'spent',
      label: 'spent · resets Sat 13:00'
    })
    // c's 5h window is below its threshold, so c is spent in the weekly view too, showing its own 50%.
    expect(rowState(accountNamed(report, 'c'), report, 'weekly', at)).toEqual({
      percent: 50,
      status: 'spent',
      label: 'spent · resets Sat 13:00'
    })
    expect(rowState(accountNamed(report, 'a'), report, 'weekly', at)).toEqual({
      percent: 70,
      status: 'active',
      label: 'active'
    })
    expect(rowState(accountNamed(report, 'd'), report, 'session', at)).toEqual({
      percent: null,
      status: 'blocked',
      label: 'blocked: authentication_failed'
    })
    // Blocked beats spent: a low reading on a blocked account still shows blocked, with no percent.
    const lowBlocked = fixture()
    accountNamed(lowBlocked, 'd').snapshot = [session(5, '2026-10-24T13:00:00+02:00')]
    expect(rowState(accountNamed(lowBlocked, 'd'), lowBlocked, 'session', at)).toEqual({
      percent: null,
      status: 'blocked',
      label: 'blocked: authentication_failed'
    })
    expect(rowState(accountNamed(lowBlocked, 'd'), lowBlocked, 'weekly', at)).toEqual({
      percent: null,
      status: 'blocked',
      label: 'blocked: authentication_failed'
    })
    expect(rowState({ name: 'e', missing: true }, report, 'session', at)).toEqual({
      percent: null,
      status: 'not-enrolled',
      label: 'not enrolled'
    })
    const unread = parseReport({
      accounts: [{ id: 'x', name: 'x', parked: true, blocked: null, snapshot: null }]
    })
    expect(rowState(accountNamed(unread, 'x'), unread, 'session', at)).toEqual({
      percent: null,
      status: 'unread',
      label: 'not read yet'
    })
  })

  it('shows an account spent on its weekly window as spent in the 5h view, labelled with the weekly reset', () => {
    const report = fixture()
    accountNamed(report, 'c').snapshot = [
      session(80, '2026-10-24T13:00:00+02:00'),
      weekly(10, '2026-10-27T09:00:00+02:00')
    ]
    // The 5h view shows the 5h percentage, with the binding weekly reset in the label.
    expect(rowState(accountNamed(report, 'c'), report, 'session', at)).toEqual({
      percent: 80,
      status: 'spent',
      label: 'spent · resets Tue 08:00'
    })
    expect(rowState(accountNamed(report, 'c'), report, 'weekly', at)).toEqual({
      percent: 10,
      status: 'spent',
      label: 'spent · resets Tue 08:00'
    })
  })

  it('shows a blocked account that is also active as active · blocked', () => {
    const report = fixture()
    report.active = { id: 'd', name: 'd' }
    expect(rowState(accountNamed(report, 'd'), report, 'session', at)).toEqual({
      percent: null,
      status: 'active',
      label: 'active · blocked: authentication_failed'
    })
  })

  it('rounds 42.01 to 42 and renders no percent without a live window', () => {
    const report = fixture()
    expect(rowState(accountNamed(report, 'a'), report, 'session', at).percent).toBe(42)
    expect(rowState(accountNamed(report, 'a'), report, 'weekly', at).percent).toBe(70)
    expect(rowState(accountNamed(report, 'd'), report, 'weekly', at).percent).toBeNull()
  })

  it('an account at exactly its threshold is not spent; the first eligible one is next', () => {
    const t = { session: 15, weekly: 10 }
    const report = reportOf({
      order: ['a', 'c', 'b'],
      active: 'a',
      thresholds: t,
      accounts: [account('a'), account('c'), account('b', { snapshot: [session(15), weekly(10)] })]
    })
    expect(rowState(accountNamed(report, 'b'), report, 'session', { now: NOW })).toEqual({
      percent: 15,
      status: 'ok',
      label: ''
    })
    expect(nextAccount(report, NOW)?.name).toBe('c')
  })
})

describe('centre', () => {
  it('says swaps next turn below the threshold, fine otherwise, and no active login when active is null', () => {
    const report = fixture()
    expect(centre(report, 'session', { now: NOW })).toEqual({
      name: 'a',
      percentText: '42% left',
      modelLines: [],
      hint: 'fine',
      next: 'b',
      tone: 'fine'
    })
    expect(centre(report, 'weekly', { now: NOW }).percentText).toBe('70% left')

    const low = fixture()
    accountNamed(low, 'a').snapshot = [
      session(10, '2026-10-21T18:00:00+02:00'),
      weekly(70, '2026-10-27T09:00:00+02:00')
    ]
    expect(centre(low, 'session', { now: NOW }).hint).toBe('below the threshold, swaps next turn')
    expect(centre(low, 'session', { now: NOW }).tone).toBe('warning')

    const spent = fixture()
    accountNamed(spent, 'a').snapshot = [
      session(0, '2026-10-21T18:00:00+02:00'),
      weekly(70, '2026-10-27T09:00:00+02:00')
    ]
    expect(centre(spent, 'session', { now: NOW }).tone).toBe('spent')

    // The hint looks at both windows: a weekly shortfall shows on the 5h view too.
    const weeklyLow = fixture()
    accountNamed(weeklyLow, 'a').snapshot = [
      session(42.01, '2026-10-21T18:00:00+02:00'),
      weekly(10, '2026-10-27T09:00:00+02:00')
    ]
    expect(centre(weeklyLow, 'session', { now: NOW }).hint).toBe(
      'below the threshold, swaps next turn'
    )

    const none = fixture()
    none.active = null
    expect(centre(none, 'session', { now: NOW })).toEqual({
      name: '—',
      percentText: '—',
      modelLines: [],
      hint: 'no active login',
      next: null,
      tone: 'none'
    })
  })
})

describe('grazrHostChip', () => {
  it('is on, off, unreachable, not deployed, managed, or foreign', () => {
    expect(grazrHostChip(ok({ settings: { enabled: true } }))).toEqual({
      kind: 'on',
      label: 'rotation on'
    })
    expect(grazrHostChip(ok({ settings: { enabled: false } }))).toEqual({
      kind: 'off',
      label: 'rotation off'
    })
    expect(grazrHostChip({ kind: 'unreachable', message: 'Connection refused' })).toEqual({
      kind: 'unreachable',
      label: 'unreachable'
    })
    expect(grazrHostChip({ kind: 'not-deployed' })).toEqual({
      kind: 'not-deployed',
      label: 'engine not installed'
    })
    expect(grazrHostChip(ok({ settings: { enabled: true }, managed_profile: true }))).toEqual({
      kind: 'managed',
      label: 'managed profile'
    })
    expect(
      grazrHostChip(
        ok({ settings: { enabled: true }, connection: { foreign: { statusline: 'other' } } })
      )
    ).toEqual({ kind: 'foreign', label: 'another grazr owns the status line' })
  })

  it('reports a host whose status line or hook is disconnected as not connected, whatever its setting says', () => {
    expect(grazrHostChip(ok({ installed: false, settings: { enabled: true } }))).toEqual({
      kind: 'not-connected',
      label: 'not connected'
    })
    // A foreign owner and a managed profile both outrank not connected.
    expect(
      grazrHostChip(
        ok({
          installed: false,
          connection: { foreign: { statusline: 'x' } },
          settings: { enabled: true }
        })
      ).kind
    ).toBe('foreign')
    expect(
      grazrHostChip(ok({ installed: false, managed_profile: true, settings: { enabled: true } }))
        .kind
    ).toBe('managed')
    // An engine that reports no installed key is read as connected.
    expect(grazrHostChip(ok({ settings: { enabled: true } }))).toEqual({
      kind: 'on',
      label: 'rotation on'
    })
  })

  it('maps the remaining host outcomes to their own chips', () => {
    expect(grazrHostChip({ kind: 'no-ssh-access' })).toEqual({
      kind: 'no-ssh-access',
      label: 'no SSH access'
    })
    expect(grazrHostChip({ kind: 'unsupported-platform' })).toEqual({
      kind: 'unsupported-platform',
      label: 'unsupported platform'
    })
    expect(grazrHostChip({ kind: 'engine-error', message: 'boom' })).toEqual({
      kind: 'engine-error',
      label: 'engine error'
    })
  })
})

describe('orderedAccounts', () => {
  it('puts named accounts first in order and adds placeholders for missing ones', () => {
    const report = fixture()
    report.order = ['c', 'missing', 'a']
    report.accounts = report.accounts.filter((a) => a.name !== 'b')
    const list = orderedAccounts(report)
    expect(list.map((a) => a.name)).toEqual(['c', 'missing', 'a', 'd'])
    expect(list[1]).toEqual({ missing: true, name: 'missing' })
  })
})

describe('buildGrazrRotationView', () => {
  it('lists rows and segments in rotation order, with the target account active and the next one marked', () => {
    const view = buildGrazrRotationView(fixture(), 'session', NOW, ZONE)
    expect(view.rows.map((r) => r.status)).toEqual(['active', 'next', 'spent', 'blocked'])
    expect(view.rows.map((r) => r.index)).toEqual([1, 2, 3, 4])
    expect(view.rows[0]?.isActive).toBe(true)
    expect(view.rows[1]?.isNext).toBe(true)
    expect(view.rows[0]?.email).toBe('a@example.com')
    expect(view.segments.map((s) => s.state)).toEqual(['active', 'next', 'spent', 'blocked'])
    expect(view.segments[0]?.remaining).toBe(42.01)
    expect(view.segments[3]?.remaining).toBeNull()
    expect(view.centre.next).toBe('b')
  })

  it('carries the blocked reason on each row, so an active blocked row can offer re-authentication', () => {
    const report = fixture()
    report.active = { id: 'd', name: 'd' }
    const rows = buildGrazrRotationView(report, 'session', NOW, ZONE).rows
    const blockedRow: GrazrRotationRow | undefined = rows.find((r) => r.name === 'd')
    expect(blockedRow?.blocked).toBe('authentication_failed')
    expect(blockedRow?.label).toBe('active · blocked: authentication_failed')
    expect(rows.find((r) => r.name === 'a')?.blocked).toBeNull()
  })

  it("keeps a name with a quote and a dollar sign unchanged (escaping is the renderer's job)", () => {
    const report = fixture()
    report.order = ['a', "o'brien $x"]
    report.accounts.push({
      id: 'q',
      name: "o'brien $x",
      email: null,
      organization: null,
      plan: null,
      updated: null,
      unused_reset: null,
      parked: true,
      in_order: true,
      blocked: null,
      first_reading_due: false,
      snapshot: null
    })
    const names = buildGrazrRotationView(report, 'session', NOW, ZONE).rows.map((r) => r.name)
    expect(names).toContain("o'brien $x")
  })
})

// A per-model weekly entry, as the engine reports Claude's Fable limit.
const fableWeek = (remaining: number, resets_at: string | null = null) => ({
  kind: 'weekly_fable',
  scope: 'Fable',
  group: 'weekly',
  remaining,
  resets_at
})

describe('windowBars', () => {
  it('lists the 5h window, the all-models week, then each per-model week, with what is left and the reset', () => {
    const bars = windowBars(
      [
        fableWeek(80, '2026-10-27T09:00:00+02:00'),
        weekly(70, '2026-10-27T09:00:00+02:00'),
        session(42.4, '2026-10-21T18:00:00+02:00')
      ],
      thresholds,
      NOW,
      ZONE
    )
    expect(bars).toEqual([
      { label: '5h', left: 42, tone: 'fine', resetText: 'resets Wed 18:00' },
      { label: 'Week', left: 70, tone: 'fine', resetText: 'resets Tue 08:00' },
      { label: 'Fable week', left: 80, tone: 'fine', resetText: 'resets Tue 08:00' }
    ])
  })

  it('reads a window past its reset as full, warns below the threshold, and calls 2% or less spent', () => {
    const bars = windowBars(
      [
        session(5, '2026-10-20T18:00:00+02:00'),
        weekly(12, '2026-10-27T09:00:00+02:00'),
        fableWeek(2)
      ],
      thresholds,
      NOW,
      ZONE
    )
    expect(bars.map((b) => [b.left, b.tone, b.resetText])).toEqual([
      [100, 'fine', 'reset since'],
      [12, 'warning', 'resets Tue 08:00'],
      [2, 'spent', '']
    ])
  })

  it('skips an entry without a reading and gives an unread account no bars', () => {
    expect(windowBars([{ ...session(50), remaining: null }], thresholds, NOW, ZONE)).toEqual([])
    expect(windowBars(null, thresholds, NOW, ZONE)).toEqual([])
  })
})

describe('per-model windows in the view', () => {
  const withFable = () => {
    const report = fixture()
    accountNamed(report, 'a').snapshot?.push(fableWeek(100, '2026-10-27T09:00:00+02:00'))
    accountNamed(report, 'b').snapshot?.push(fableWeek(35))
    return report
  }

  it('names each model with a weekly limit of its own once, sorted', () => {
    expect(modelScopes(fixture())).toEqual([])
    expect(modelScopes(withFable())).toEqual(['Fable'])
  })

  it('on the weekly view gives every segment its per-model left and the centre a model line', () => {
    const view = buildGrazrRotationView(withFable(), 'weekly', NOW, ZONE)
    expect(view.modelScopes).toEqual(['Fable'])
    expect(view.segments.map((s) => s.models)).toEqual([
      { Fable: 100 },
      { Fable: 35 },
      { Fable: null },
      { Fable: null }
    ])
    expect(view.centre.modelLines).toEqual(['Fable 100% left'])
    expect(view.rows[0]?.windows.map((w) => w.label)).toEqual(['5h', 'Week', 'Fable week'])
  })

  it('on the 5h view shows no model rings or lines', () => {
    const view = buildGrazrRotationView(withFable(), 'session', NOW, ZONE)
    expect(view.modelScopes).toEqual([])
    expect(view.segments[0]?.models).toEqual({})
    expect(view.centre.modelLines).toEqual([])
  })

  it('carries the plan label, the organization and the reading age on each row', () => {
    const report = fixture()
    const a = accountNamed(report, 'a')
    a.plan = { type: 'claude_max', tier: 'default_claude_max_20x', seat_tier: null }
    a.organization = 'Imperum'
    a.updated = NOW.getTime() / 1000 - 8 * 86_400
    const [row, other] = buildGrazrRotationView(report, 'weekly', NOW, ZONE).rows
    expect(row).toMatchObject({
      plan: 'Max 20x',
      organization: 'Imperum',
      readingFrom: '1 wk. ago'
    })
    expect(other).toMatchObject({ plan: null, organization: null, readingFrom: null })
    expect(other?.windows.map((w) => w.label)).toEqual(['5h', 'Week'])
  })
})

describe('relativeAge', () => {
  it('says weeks, days, hours or minutes ago, and just now under a minute', () => {
    const seconds = NOW.getTime() / 1000
    expect(relativeAge(seconds - 15 * 86_400, NOW)).toBe('2 wk. ago')
    expect(relativeAge(seconds - 3 * 86_400, NOW)).toBe('3 days ago')
    expect(relativeAge(seconds - 2 * 3600, NOW)).toBe('2 hr. ago')
    expect(relativeAge(seconds - 90, NOW)).toBe('1 min. ago')
    expect(relativeAge(seconds - 5, NOW)).toBe('just now')
    expect(relativeAge(seconds + 100, NOW)).toBe('just now')
  })
})
