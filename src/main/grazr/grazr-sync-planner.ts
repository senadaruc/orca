import { shortfallOf } from '../../shared/grazr-rotation-view'
import type { GrazrStatusAccount, GrazrStatusReport } from '../../shared/grazr-status-report'
import { sameSyncState, syncStateOf, uniqued, type GrazrSyncState } from './grazr-sync-state'

// Keeps several devices' grazr on one ACCOUNTS order and one active account. There is no leader:
// the device that changed most recently wins, and the others are pushed to its state. Pure
// bookkeeping; a caller runs the pushes. A port of HerdrM's GrazrSyncPlanner.

/** A device taking part in the sync, with its latest grazr report. */
export type GrazrSyncMember = { key: string; name: string; report: GrazrStatusReport }

/** The state every device is brought to: the newest change seen, and the device it came from. */
export type GrazrSyncTarget = {
  orderIds: string[]
  activeId: string | null
  at: number
  source: string
}

/** Why a device cannot follow the target. */
export type GrazrSyncProblem =
  | { kind: 'not-enrolled'; accountId: string }
  | { kind: 'blocked'; accountId: string; reason: string }
  // The device's grazr cannot set ACCOUNTS this way.
  | { kind: 'needs-update' }
  // grazr's own refusal, in its words.
  | { kind: 'refused'; text: string }

/** What to do on one device: write its order (in its own names), switch its active account, or
 *  say why it cannot. */
export type GrazrSyncPush = {
  device: string
  // Null when the order already agrees.
  orderNames: string[] | null
  switchTo: string | null
  problem: GrazrSyncProblem | null
}

/** Two devices whose grazrs kept undoing each other: `source`'s state was pushed to `follower`,
 *  whose grazr rotated away again. */
export type GrazrSyncBounce = { source: string; follower: string }

/** What a restart must not forget: without `lastSeen` a device's state as Orca pushed it reads as
 *  its own change, and the newest stamp (often a follower's) would win. Pushes in flight are not kept. */
export type GrazrSyncPlannerSnapshot = {
  lastSeen: Record<string, GrazrSyncState>
  target: GrazrSyncTarget | null
  pausedUntil: number | null
  bouncing: GrazrSyncBounce | null
}

// Changes this close together are one moment; the lower name wins.
export const TIE_WINDOW = 30
// A follower rotating away this soon after a push undid it.
export const BOUNCE_WINDOW = 120
// Two bounces this close together pause the sync.
export const BOUNCE_SPAN = 600
export const PAUSE_LENGTH = 1800
// A follower that could not follow is asked again after this long, or sooner when its report changes.
export const RETRY_AFTER = 600

// The device as a push found it, so an unchanged one is not asked again.
type Fingerprint = string

// The last push to a device. `pushedAccount` is the switch it asked for, kept for the bounce check
// until it lands somewhere else or fails.
type Attempt = {
  targetAt: number
  fingerprint: Fingerprint
  at: number
  pushedAccount: string | null
  hadHeadroom: boolean
  source: string
}

const targetState = (target: GrazrSyncTarget): GrazrSyncState => ({
  orderIds: target.orderIds,
  activeId: target.activeId,
  changedAt: null
})

// A block still in force, in the engine's words; the engine clears a lapsed one itself.
function blockOf(account: GrazrStatusAccount): string | null {
  return account.blocked !== null && account.blocked !== '' ? account.blocked : null
}

// No live window below its threshold: grazr would not rotate away from it on its own.
function hasHeadroom(account: GrazrStatusAccount, report: GrazrStatusReport, now: number): boolean {
  const { thresholds, model_limits } = report.settings
  return shortfallOf(account.snapshot, thresholds, new Date(now * 1000), model_limits) === null
}

export class GrazrSyncPlanner {
  lastSeen = new Map<string, GrazrSyncState>()
  target: GrazrSyncTarget | null = null
  pausedUntil: number | null = null
  bouncing: GrazrSyncBounce | null = null
  private attempts = new Map<string, Attempt>()
  private bounces: number[] = []
  private names = new Map<string, string>()

  static restore(snapshot: GrazrSyncPlannerSnapshot): GrazrSyncPlanner {
    const planner = new GrazrSyncPlanner()
    planner.lastSeen = new Map(Object.entries(snapshot.lastSeen))
    planner.target = snapshot.target
    planner.pausedUntil = snapshot.pausedUntil
    planner.bouncing = snapshot.bouncing
    return planner
  }

  snapshot(): GrazrSyncPlannerSnapshot {
    return {
      lastSeen: Object.fromEntries(this.lastSeen),
      target: this.target,
      pausedUntil: this.pausedUntil,
      bouncing: this.bouncing
    }
  }

  /** One round of reports in, the pushes that bring the rest to the target out. */
  observe(devices: GrazrSyncMember[], now: number): GrazrSyncPush[] {
    const states = devices.map((device) => syncStateOf(device.report))
    for (const device of devices) {
      this.names.set(device.key, device.name)
    }
    const changed = devices.flatMap((device, i) => {
      const state = states[i]
      if (state === undefined) {
        return []
      }
      const seen = this.lastSeen.get(device.key)
      return seen === undefined || !sameSyncState(seen, state) ? [{ device, state }] : []
    })
    this.adoptNewest(changed)
    devices.forEach((device, i) => {
      const state = states[i]
      if (state !== undefined) {
        this.lastSeen.set(device.key, state)
      }
    })

    if (this.pausedUntil !== null) {
      if (now < this.pausedUntil) {
        return []
      }
      this.pausedUntil = null
      this.bouncing = null
    }
    if (this.countBounces(devices, states, now)) {
      return []
    }
    const target = this.target
    if (target === null) {
      return []
    }
    return devices.flatMap((device, i) => {
      const state = states[i]
      const push = state === undefined ? null : this.push(device, state, target, now)
      return push === null ? [] : [push]
    })
  }

  /** For a device Orca just pushed: its new state is the push landing, not a change of its own to spread. */
  settle(device: GrazrSyncMember): void {
    this.lastSeen.set(device.key, syncStateOf(device.report))
  }

  /** After a push ran. grazr busy rotating is passing, so the next round tries again; any other
   *  problem waits for the device to change or for RETRY_AFTER. */
  recordResult(device: string, problem: GrazrSyncProblem | null, now: number): void {
    const attempt = this.attempts.get(device)
    if (attempt === undefined) {
      return
    }
    if (problem?.kind === 'refused' && problem.text.includes('Busy rotating')) {
      this.attempts.delete(device)
      return
    }
    attempt.at = now
    // A switch that did not happen cannot be undone by the device's grazr.
    if (problem !== null) {
      attempt.pushedAccount = null
    }
  }

  /** A device left out of the sync. If it was the source, a device already on the target takes the
   *  lead (the first by name); with none, nothing moves until a device changes. What the others
   *  were seen as stays, so a push Orca made is not taken for a change of theirs. A pause it caused
   *  ends with it. */
  forget(key: string): void {
    this.attempts.delete(key)
    this.lastSeen.delete(key)
    this.names.delete(key)
    for (const attempt of this.attempts.values()) {
      if (attempt.source === key) {
        attempt.pushedAccount = null
      }
    }
    const target = this.target
    if (target !== null && target.source === key) {
      const wanted = targetState(target)
      // Only a device seen this run: one that left unasked has no name.
      const heirs = [...this.lastSeen.entries()]
        .filter(([id, state]) => this.names.has(id) && sameSyncState(state, wanted))
        .map(([id]) => id)
        .sort((a, b) => (this.names.get(a) ?? '').localeCompare(this.names.get(b) ?? ''))
      const heir = heirs[0]
      this.target = heir === undefined ? null : { ...target, source: heir }
    }
    if (this.bouncing?.source === key || this.bouncing?.follower === key) {
      this.bouncing = null
      this.pausedUntil = null
    }
  }

  // The newest changed device becomes the target when it is newer than the target, or ties it and
  // wins by name. A device without a changedAt wins only when none is dated and there is no target yet.
  private adoptNewest(changed: { device: GrazrSyncMember; state: GrazrSyncState }[]): void {
    const dated = changed.filter(({ state }) => state.changedAt !== null)
    const pool = dated.length === 0 ? changed : dated
    if (pool.length === 0) {
      return
    }
    const newest = Math.max(...pool.map(({ state }) => state.changedAt ?? 0))
    const winner = pool
      .filter(({ state }) => (state.changedAt ?? 0) >= newest - TIE_WINDOW)
      .sort((a, b) => a.device.name.localeCompare(b.device.name))[0]
    if (winner === undefined) {
      return
    }
    const at = winner.state.changedAt ?? 0
    const target = this.target
    if (target !== null) {
      if (winner.state.changedAt === null) {
        return
      }
      const newer = at > target.at + TIE_WINDOW
      const ties =
        Math.abs(at - target.at) <= TIE_WINDOW &&
        (winner.device.key === target.source ||
          winner.device.name < (this.names.get(target.source) ?? ''))
      if (!newer && !ties) {
        return
      }
    }
    this.target = {
      orderIds: winner.state.orderIds,
      activeId: winner.state.activeId,
      at,
      source: winner.device.key
    }
  }

  // A follower whose grazr moved off a pushed account that still had headroom there, soon after
  // the push. The second within BOUNCE_SPAN pauses the sync; true then.
  private countBounces(devices: GrazrSyncMember[], states: GrazrSyncState[], now: number): boolean {
    for (const [i, device] of devices.entries()) {
      const attempt = this.attempts.get(device.key)
      const state = states[i]
      if (
        attempt === undefined ||
        attempt.pushedAccount === null ||
        !attempt.hadHeadroom ||
        now - attempt.at > BOUNCE_WINDOW ||
        state === undefined ||
        state.activeId === attempt.pushedAccount
      ) {
        continue
      }
      attempt.pushedAccount = null
      this.bounces = [...this.bounces.filter((at) => now - at <= BOUNCE_SPAN), now]
      if (this.bounces.length >= 2) {
        this.pausedUntil = now + PAUSE_LENGTH
        this.bouncing = { source: attempt.source, follower: device.key }
        this.bounces = []
        return true
      }
    }
    return false
  }

  // The target in the device's own terms: its order rewritten in its names, extra accounts last,
  // and a switch or the reason it cannot. Null for the source, a device already there, or one asked
  // already that has not changed since.
  private push(
    device: GrazrSyncMember,
    state: GrazrSyncState,
    target: GrazrSyncTarget,
    now: number
  ): GrazrSyncPush | null {
    if (device.key === target.source || sameSyncState(state, targetState(target))) {
      return null
    }
    const { report } = device
    const enrolled = new Set(report.accounts.map((a) => a.id))
    // Only blocks still in force: one lapsing is a change worth retrying for.
    const blocked = report.accounts
      .filter((a) => blockOf(a) !== null)
      .map((a) => a.id)
      .sort()
    const fingerprint = JSON.stringify([state, blocked, [...enrolled].sort()])
    const attempt = this.attempts.get(device.key)
    if (
      attempt !== undefined &&
      attempt.targetAt === target.at &&
      attempt.fingerprint === fingerprint &&
      now - attempt.at < RETRY_AFTER
    ) {
      return null
    }

    const wanted = new Set(target.orderIds)
    const order = uniqued([
      ...target.orderIds.filter((id) => enrolled.has(id)),
      ...state.orderIds.filter((id) => !wanted.has(id))
    ])
    const sameOrder =
      order.length === state.orderIds.length && order.every((id, i) => id === state.orderIds[i])
    const orderNames = sameOrder
      ? null
      : order.flatMap((id) => report.accounts.find((a) => a.id === id)?.name ?? [])

    let switchTo: string | null = null
    let problem: GrazrSyncProblem | null = null
    const account = target.activeId
    if (account !== null && account !== state.activeId) {
      const record = report.accounts.find((a) => a.id === account)
      const block = record ? blockOf(record) : null
      if (!enrolled.has(account)) {
        problem = { kind: 'not-enrolled', accountId: account }
      } else if (block !== null) {
        problem = { kind: 'blocked', accountId: account, reason: block }
      } else {
        switchTo = account
      }
    }
    if (orderNames === null && switchTo === null && problem === null) {
      return null
    }

    const pushed = switchTo === null ? null : report.accounts.find((a) => a.id === switchTo)
    this.attempts.set(device.key, {
      targetAt: target.at,
      fingerprint,
      at: now,
      pushedAccount: switchTo,
      hadHeadroom: pushed ? hasHeadroom(pushed, report, now) : false,
      source: target.source
    })
    return { device: device.key, orderNames, switchTo, problem }
  }
}
