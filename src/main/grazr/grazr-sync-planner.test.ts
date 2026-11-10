import { describe, expect, it } from 'vitest'
import type { GrazrSnapshotEntry, GrazrStatusReport } from '../../shared/grazr-status-report'
import {
  GrazrSyncPlanner,
  type GrazrSyncMember,
  type GrazrSyncProblem,
  type GrazrSyncPush
} from './grazr-sync-planner'
import { sameSyncState, syncStateOf } from './grazr-sync-state'

const A = 'a-key'
const B = 'b-key'
const C = 'c-key'
const standard: [string, string][] = [
  ['g', 'gmail'],
  ['i', 'icloud'],
  ['w', 'work']
]

function member(
  name: string,
  key: string,
  options: {
    order: string[]
    active: string | null
    accounts?: [string, string][]
    blocked?: Record<string, string>
    windows?: Record<string, GrazrSnapshotEntry[]>
    changedAt: number | null
  }
): GrazrSyncMember {
  const accounts = options.accounts ?? standard
  const report: GrazrStatusReport = {
    version: '0.4.7+fork.13',
    installed: true,
    managed_profile: false,
    connection: { statusline: null, failure_hook: null, foreign: null },
    active:
      options.active === null
        ? null
        : { id: options.active, name: accounts.find(([id]) => id === options.active)?.[1] ?? '' },
    accounts: accounts.map(([id, accountName]) => ({
      id,
      name: accountName,
      email: null,
      organization: null,
      plan: null,
      updated: null,
      unused_reset: null,
      parked: true,
      in_order: true,
      first_reading_due: false,
      blocked: options.blocked?.[id] ?? null,
      snapshot: options.windows?.[id] ?? []
    })),
    order: options.order,
    changed_at: options.changedAt,
    settings: { enabled: true, model_limits: false, thresholds: { session: 20, weekly: 20 } }
  }
  return { key, name, report }
}

const push = (
  device: string,
  {
    order = null,
    to = null,
    problem = null
  }: Partial<Omit<GrazrSyncPush, 'device'>> & {
    order?: string[] | null
    to?: string | null
  } = {}
): GrazrSyncPush => ({ device, orderNames: order, switchTo: to, problem })

const gi = ['gmail', 'icloud']
const giw = ['gmail', 'icloud', 'work']
const blockedI: GrazrSyncProblem = { kind: 'blocked', accountId: 'i', reason: 'rate limited' }

describe('GrazrSyncPlanner', () => {
  it('first round picks the newest device and pushes to the others', () => {
    const planner = new GrazrSyncPlanner()
    const pushes = planner.observe(
      [
        member('a', A, { order: gi, active: 'g', changedAt: 1000 }),
        member('b', B, { order: ['icloud', 'gmail'], active: 'i', changedAt: 2000 }),
        member('c', C, { order: gi, active: 'g', changedAt: 500 })
      ],
      0
    )
    expect(planner.target?.source).toBe(B)
    expect(pushes).toEqual([
      push(A, { order: ['icloud', 'gmail'], to: 'i' }),
      push(C, { order: ['icloud', 'gmail'], to: 'i' })
    ])
  })

  it('a lone rotation on one device propagates', () => {
    const planner = new GrazrSyncPlanner()
    const same = (active: string, changedAt: number) => ({ order: gi, active, changedAt })
    expect(
      planner.observe(
        [
          member('a', A, same('g', 1000)),
          member('b', B, same('g', 1000)),
          member('c', C, same('g', 1000))
        ],
        0
      )
    ).toEqual([])
    const pushes = planner.observe(
      [
        member('a', A, same('g', 1000)),
        member('b', B, same('i', 2000)),
        member('c', C, same('g', 1000))
      ],
      10
    )
    expect(planner.target?.source).toBe(B)
    expect(pushes).toEqual([push(A, { to: 'i' }), push(C, { to: 'i' })])
  })

  it('two devices changing in one round settle by changedAt, a tie by device name', () => {
    const planner = new GrazrSyncPlanner()
    planner.observe(
      [
        member('a', A, { order: giw, active: 'g', changedAt: 1000 }),
        member('b', B, { order: giw, active: 'g', changedAt: 1000 }),
        member('c', C, { order: giw, active: 'g', changedAt: 1000 })
      ],
      0
    )
    const pushes = planner.observe(
      [
        member('a', A, { order: giw, active: 'i', changedAt: 3000 }),
        member('b', B, { order: giw, active: 'w', changedAt: 3100 }),
        member('c', C, { order: giw, active: 'g', changedAt: 1000 })
      ],
      10
    )
    expect(planner.target).toMatchObject({ source: B, activeId: 'w' })
    expect(pushes).toEqual([push(A, { to: 'w' }), push(C, { to: 'w' })])

    const tie = new GrazrSyncPlanner()
    tie.observe(
      [
        member('alpha', A, { order: giw, active: 'g', changedAt: 1000 }),
        member('beta', B, { order: giw, active: 'g', changedAt: 1000 })
      ],
      0
    )
    const tied = tie.observe(
      [
        member('alpha', A, { order: giw, active: 'i', changedAt: 3000 }),
        member('beta', B, { order: giw, active: 'w', changedAt: 3010 })
      ],
      10
    )
    expect(tie.target?.source).toBe(A)
    expect(tied).toEqual([push(B, { to: 'i' })])
  })

  it('a device without changedAt never wins, and its later drift is pushed back', () => {
    const planner = new GrazrSyncPlanner()
    const pushes = planner.observe(
      [
        member('alpha', A, { order: gi, active: 'g', changedAt: null }),
        member('beta', B, { order: gi, active: 'i', changedAt: 1 })
      ],
      0
    )
    expect(planner.target?.source).toBe(B)
    expect(pushes).toEqual([push(A, { to: 'i' })])
    const again = planner.observe(
      [
        member('alpha', A, { order: gi, active: 'w', changedAt: null }),
        member('beta', B, { order: gi, active: 'i', changedAt: 1 })
      ],
      10
    )
    expect(planner.target?.source).toBe(B)
    expect(again).toEqual([push(A, { to: 'i' })])
  })

  it('extra accounts on one device do not differ', () => {
    const planner = new GrazrSyncPlanner()
    const a = member('a', A, { order: giw, active: 'g', changedAt: 1000 })
    const b = member('b', B, {
      order: gi,
      active: 'g',
      accounts: [
        ['g', 'gmail'],
        ['i', 'icloud']
      ],
      changedAt: 2000
    })
    expect(planner.observe([a, b], 0)).toEqual([])
    expect(planner.observe([a, b], 10)).toEqual([])
    expect(
      planner.observe([member('a', A, { order: giw, active: 'g', changedAt: 5000 }), b], 20)
    ).toEqual([])
  })

  it('a partial follower does not become the source and is asked again after the retry window or when its block lifts', () => {
    const planner = new GrazrSyncPlanner()
    const a = member('a', A, {
      order: gi,
      active: 'g',
      blocked: { i: 'rate limited' },
      changedAt: 1000
    })
    const b = member('b', B, { order: gi, active: 'i', changedAt: 2000 })
    expect(planner.observe([a, b], 0)).toEqual([push(A, { problem: blockedI })])
    planner.recordResult(A, blockedI, 0)
    expect(planner.observe([a, b], 300)).toEqual([])
    expect(planner.target?.source).toBe(B)
    expect(planner.observe([a, b], 601)).toEqual([push(A, { problem: blockedI })])

    const lifted = new GrazrSyncPlanner()
    expect(lifted.observe([a, b], 0)).toEqual([push(A, { problem: blockedI })])
    lifted.recordResult(A, blockedI, 0)
    expect(
      lifted.observe([member('a', A, { order: gi, active: 'g', changedAt: 1000 }), b], 30)
    ).toEqual([push(A, { to: 'i' })])
  })

  it('reports not enrolled instead of pushing', () => {
    const planner = new GrazrSyncPlanner()
    const pushes = planner.observe(
      [
        member('a', A, { order: giw, active: 'w', changedAt: 2000 }),
        member('b', B, {
          order: gi,
          active: 'g',
          accounts: [
            ['g', 'gmail'],
            ['i', 'icloud']
          ],
          changedAt: 1000
        })
      ],
      0
    )
    expect(pushes).toEqual([push(B, { problem: { kind: 'not-enrolled', accountId: 'w' } })])
  })

  it("writes the order in the follower's own names, extra accounts last", () => {
    const planner = new GrazrSyncPlanner()
    const pushes = planner.observe(
      [
        member('a', A, {
          order: ['icloud', 'gmail'],
          active: 'i',
          accounts: [
            ['g', 'gmail'],
            ['i', 'icloud']
          ],
          changedAt: 2000
        }),
        member('b', B, {
          order: ['personal', 'spare', 'apple'],
          active: 'i',
          accounts: [
            ['g', 'personal'],
            ['i', 'apple'],
            ['x', 'spare']
          ],
          changedAt: 1000
        })
      ],
      0
    )
    expect(pushes).toEqual([push(B, { order: ['apple', 'personal', 'spare'] })])
  })

  it('two bounces pause the sync until the pause ends', () => {
    const planner = new GrazrSyncPlanner()
    expect(
      planner.observe(
        [
          member('a', A, { order: gi, active: 'g', changedAt: 1000 }),
          member('b', B, { order: gi, active: 'i', changedAt: 2000 })
        ],
        0
      )
    ).toEqual([push(A, { to: 'i' })])
    planner.recordResult(A, null, 0)
    planner.settle(member('a', A, { order: gi, active: 'i', changedAt: 2010 }))

    // grazr on A rotates away from i, which had headroom there.
    expect(
      planner.observe(
        [
          member('a', A, { order: gi, active: 'g', changedAt: 2100 }),
          member('b', B, { order: gi, active: 'i', changedAt: 2000 })
        ],
        60
      )
    ).toEqual([push(B, { to: 'g' })])
    expect(planner.pausedUntil).toBeNull()
    planner.recordResult(B, null, 60)
    planner.settle(member('b', B, { order: gi, active: 'g', changedAt: 2110 }))

    // And grazr on B undoes that in turn: the second bounce pauses.
    const rounds = [
      member('a', A, { order: gi, active: 'g', changedAt: 2100 }),
      member('b', B, { order: gi, active: 'i', changedAt: 2200 })
    ]
    expect(planner.observe(rounds, 120)).toEqual([])
    expect(planner.pausedUntil).toBe(120 + 1800)
    expect(planner.bouncing).toEqual({ source: A, follower: B })
    expect(planner.observe(rounds, 600)).toEqual([])

    expect(planner.observe(rounds, 1921)).toEqual([push(A, { to: 'i' })])
    expect(planner.pausedUntil).toBeNull()
    expect(planner.bouncing).toBeNull()
  })

  it('a rotation away from a low account is not a bounce', () => {
    const planner = new GrazrSyncPlanner()
    const low: Record<string, GrazrSnapshotEntry[]> = {
      i: [
        {
          kind: 'five_hour',
          scope: null,
          group: 'session',
          remaining: 5,
          resets_at: '2286-11-20T17:46:40Z'
        }
      ]
    }
    expect(
      planner.observe(
        [
          member('a', A, { order: gi, active: 'g', windows: low, changedAt: 1000 }),
          member('b', B, { order: gi, active: 'i', changedAt: 2000 })
        ],
        0
      )
    ).toEqual([push(A, { to: 'i' })])
    planner.recordResult(A, null, 0)
    planner.settle(member('a', A, { order: gi, active: 'i', windows: low, changedAt: 2010 }))
    expect(
      planner.observe(
        [
          member('a', A, { order: gi, active: 'g', windows: low, changedAt: 2100 }),
          member('b', B, { order: gi, active: 'i', changedAt: 2000 })
        ],
        60
      )
    ).toEqual([push(B, { to: 'g' })])
    planner.recordResult(B, null, 60)
    planner.settle(member('b', B, { order: gi, active: 'g', changedAt: 2110 }))

    // B rotating away from g (with headroom) is one bounce, not two.
    expect(
      planner.observe(
        [
          member('a', A, { order: gi, active: 'g', windows: low, changedAt: 2100 }),
          member('b', B, { order: gi, active: 'i', changedAt: 2200 })
        ],
        120
      )
    ).toEqual([push(A, { to: 'i' })])
    expect(planner.pausedUntil).toBeNull()
  })

  it('a late joiner with an older change follows and with a newer one wins', () => {
    const a = member('a', A, { order: gi, active: 'g', changedAt: 1000 })
    const b = member('b', B, { order: gi, active: 'g', changedAt: 1100 })

    const older = new GrazrSyncPlanner()
    expect(older.observe([a, b], 0)).toEqual([])
    const follows = older.observe(
      [a, b, member('c', C, { order: gi, active: 'i', changedAt: 500 })],
      10
    )
    expect(older.target?.source).toBe(B)
    expect(follows).toEqual([push(C, { to: 'g' })])

    const newer = new GrazrSyncPlanner()
    expect(newer.observe([a, b], 0)).toEqual([])
    const wins = newer.observe(
      [a, b, member('c', C, { order: ['icloud', 'gmail'], active: 'i', changedAt: 5000 })],
      10
    )
    expect(newer.target?.source).toBe(C)
    expect(wins).toEqual([
      push(A, { order: ['icloud', 'gmail'], to: 'i' }),
      push(B, { order: ['icloud', 'gmail'], to: 'i' })
    ])
  })

  it('settle does not make a device a change source', () => {
    const first = [
      member('a', A, { order: gi, active: 'g', changedAt: 1000 }),
      member('b', B, { order: gi, active: 'i', changedAt: 2000 })
    ]
    const landed = member('a', A, { order: gi, active: 'i', changedAt: 5000 })
    const second = [landed, first[1]!]

    const settled = new GrazrSyncPlanner()
    expect(settled.observe(first, 0)).toEqual([push(A, { to: 'i' })])
    settled.recordResult(A, null, 0)
    settled.settle(landed)
    expect(settled.lastSeen.get(A)).toEqual({
      orderIds: ['g', 'i'],
      activeId: 'i',
      changedAt: 5000
    })
    expect(settled.observe(second, 30)).toEqual([])
    expect(settled.target?.source).toBe(B)

    // Without settle, the landed push would read as A's own change.
    const unsettled = new GrazrSyncPlanner()
    unsettled.observe(first, 0)
    unsettled.observe(second, 30)
    expect(unsettled.target?.source).toBe(A)
  })

  it('retries busy rotating next round and any other refusal only after a change or the retry window', () => {
    const planner = new GrazrSyncPlanner()
    const round = [
      member('a', A, { order: gi, active: 'g', changedAt: 1000 }),
      member('b', B, { order: gi, active: 'i', changedAt: 2000 })
    ]
    expect(planner.observe(round, 0)).toEqual([push(A, { to: 'i' })])
    planner.recordResult(
      A,
      { kind: 'refused', text: 'grazr: Busy rotating already, try again shortly' },
      0
    )
    expect(planner.observe(round, 10)).toEqual([push(A, { to: 'i' })])
    planner.recordResult(A, { kind: 'refused', text: 'Already on that account' }, 10)
    expect(planner.observe(round, 20)).toEqual([])
  })

  // After a restart the order Orca pushed to a blocked follower bumps its changed_at past the
  // source's. A planner restored from its snapshot knows that state and keeps the source; a fresh
  // one would crown the follower and move everyone to its account.
  it('a restored snapshot keeps a pushed follower from winning', () => {
    const planner = new GrazrSyncPlanner()
    const ig = ['icloud', 'gmail']
    const a = member('a', A, { order: ig, active: 'i', changedAt: 2000 })
    const c = member('c', C, { order: ig, active: 'i', changedAt: 1500 })
    const b = member('b', B, {
      order: gi,
      active: 'g',
      blocked: { i: 'rate limited' },
      changedAt: 1000
    })
    expect(planner.observe([a, b, c], 0)).toEqual([push(B, { order: ig, problem: blockedI })])
    const pushed = member('b', B, {
      order: ig,
      active: 'g',
      blocked: { i: 'rate limited' },
      changedAt: 3000
    })
    planner.settle(pushed)
    planner.recordResult(B, blockedI, 0)

    const restored = GrazrSyncPlanner.restore(JSON.parse(JSON.stringify(planner.snapshot())))
    expect(restored.snapshot()).toEqual(planner.snapshot())
    expect(restored.observe([a, pushed, c], 60)).toEqual([push(B, { problem: blockedI })])
    expect(restored.target?.source).toBe(A)

    const fresh = new GrazrSyncPlanner()
    expect(fresh.observe([a, pushed, c], 60)).toEqual([push(A, { to: 'g' }), push(C, { to: 'g' })])
  })

  it('forgetting the source lets the newest remaining device lead, or one already in step', () => {
    const accounts: [string, string][] = [
      ['id-work', 'work'],
      ['id-home', 'home']
    ]
    const studio = member('studio', 'studio', {
      order: ['work', 'home'],
      active: 'id-work',
      accounts,
      changedAt: 3000
    })
    const laptop = member('laptop', 'laptop', {
      order: ['home', 'work'],
      active: 'id-home',
      accounts,
      changedAt: 2000
    })
    const desk = member('desk', 'desk', {
      order: ['home', 'work'],
      active: 'id-work',
      accounts,
      changedAt: 1000
    })
    const planner = new GrazrSyncPlanner()
    const first = planner.observe([studio, laptop, desk], 3000)
    expect(planner.target?.source).toBe('studio')
    expect(new Set(first.map((p) => p.device))).toEqual(new Set(['laptop', 'desk']))

    // studio leaves before anyone followed: no lead, and nothing moves until a device changes.
    planner.forget('studio')
    expect(planner.target).toBeNull()
    expect(planner.observe([laptop, desk], 3100)).toEqual([])
    const moved = member('laptop', 'laptop', {
      order: ['work', 'home'],
      active: 'id-home',
      accounts,
      changedAt: 3100
    })
    const next = planner.observe([moved, desk], 3100)
    expect(planner.target?.source).toBe('laptop')
    expect(next).toEqual([push('desk', { order: ['work', 'home'], to: 'id-home' })])

    // A follower leaving is forgotten: back, it is asked again.
    planner.forget('desk')
    expect(planner.observe([moved, desk], 3200).map((p) => p.device)).toEqual(['desk'])

    // The source leaving after a push: a device on the target leads, and the pushed follower,
    // stamped newest by the order push, does not drag it along.
    const handover = new GrazrSyncPlanner()
    const ig = ['icloud', 'gmail']
    const a = member('a', A, { order: ig, active: 'i', changedAt: 2000 })
    const c = member('c', C, { order: ig, active: 'i', changedAt: 1500 })
    const b = member('b', B, {
      order: gi,
      active: 'g',
      blocked: { i: 'rate limited' },
      changedAt: 1000
    })
    expect(handover.observe([a, b, c], 0)).toEqual([push(B, { order: ig, problem: blockedI })])
    const pushed = member('b', B, {
      order: ig,
      active: 'g',
      blocked: { i: 'rate limited' },
      changedAt: 3000
    })
    handover.settle(pushed)
    handover.recordResult(B, blockedI, 0)
    handover.forget(A)
    expect(handover.target?.source).toBe(C)
    const pushes = handover.observe([pushed, c], 120)
    expect(pushes.some((p) => p.device === C)).toBe(false)
    expect(handover.target?.activeId).toBe('i')
  })
})

describe('syncStateOf', () => {
  it('maps order names to ids and equality ignores unshared accounts', () => {
    const listed = member('x', 'x', {
      order: ['icloud', 'gone', 'gmail'],
      active: 'i',
      accounts: [
        ['g', 'gmail'],
        ['i', 'icloud']
      ],
      changedAt: 7
    })
    expect(syncStateOf(listed.report)).toEqual({
      orderIds: ['i', 'g'],
      activeId: 'i',
      changedAt: 7
    })
    const unlisted = member('y', 'y', {
      order: [],
      active: null,
      accounts: [
        ['w', 'work'],
        ['g', 'gmail']
      ],
      changedAt: null
    })
    expect(syncStateOf(unlisted.report).orderIds).toEqual(['g', 'w'])
    expect(
      sameSyncState(
        { orderIds: ['i', 'x', 'g'], activeId: 'i', changedAt: 1 },
        { orderIds: ['i', 'g'], activeId: 'i', changedAt: 2 }
      )
    ).toBe(true)
    expect(
      sameSyncState(
        { orderIds: ['g', 'i'], activeId: 'i', changedAt: null },
        { orderIds: ['i', 'g'], activeId: 'i', changedAt: null }
      )
    ).toBe(false)
  })
})
