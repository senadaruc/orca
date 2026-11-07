import type { GrazrApi } from '../../shared/grazr-api-types'
import type { GrazrSyncSnapshot } from '../../shared/grazr-sync-types'
import type { GrazrSyncDeviceRef } from './grazr-sync-devices'
import { GrazrSyncPlanner, type GrazrSyncPlannerSnapshot } from './grazr-sync-planner'
import { runGrazrSyncRound, type GrazrSyncRoundState } from './grazr-sync-round'

// Keeps every device's grazr (this computer's too) on one ACCOUNTS order and one active account: a
// round each minute, and one after any grazr action Orca performs. The device that changed last
// wins; GrazrSyncPlanner decides, grazr-sync-round runs its pushes through the engine on each host.
// A port of HerdrM's GrazrSyncCoordinator.

/** What the state file holds. */
export type GrazrSyncSaved = {
  enabled: boolean
  applied: boolean
  excluded: string[]
  planner: GrazrSyncPlannerSnapshot | null
  unsettled: string[]
}

export type GrazrSyncCoordinatorDeps = {
  grazr: Pick<GrazrApi, 'status' | 'setAccounts' | 'swap'>
  listDevices: () => GrazrSyncDeviceRef[]
  // Epoch seconds.
  now: () => number
  intervalMs: number
  // Schedules one call and hands back its cancel.
  setTimer: (fn: () => void, ms: number) => () => void
  load: () => Promise<GrazrSyncSaved | null>
  save: (saved: GrazrSyncSaved) => Promise<void>
  notify: (title: string, body: string) => void
  broadcast: (snapshot: GrazrSyncSnapshot) => void
}

function freshState(excluded: Set<string>): GrazrSyncRoundState {
  return {
    planner: new GrazrSyncPlanner(),
    reports: new Map(),
    problems: new Map(),
    pushedAnything: false,
    unsettled: new Set(),
    unconfirmed: new Map(),
    heldForApproval: false,
    excluded,
    status: { kind: 'off' }
  }
}

export class GrazrSyncCoordinator {
  private enabled = false
  private applied = false
  private state = freshState(new Set())
  private loopCancel: (() => void) | null = null
  private running = false
  private runAgain = false
  // Bumped by every on/off, so a round from before stops pushing.
  private generation = 0
  /** The latest round started by setEnabled, apply or kick, so a caller can wait for it. */
  pendingRound: Promise<void> = Promise.resolve()

  constructor(private readonly deps: GrazrSyncCoordinatorDeps) {}

  /** At launch: applied, the sync carries on from the saved state without a preview; not yet
   *  applied, the preview is shown again. */
  async start(): Promise<void> {
    const saved = await this.deps.load()
    if (saved !== null) {
      this.enabled = saved.enabled
      this.applied = saved.applied
      this.state.excluded = new Set(saved.excluded)
      this.state.unsettled = new Set(saved.unsettled)
      if (saved.planner !== null) {
        this.state.planner = GrazrSyncPlanner.restore(saved.planner)
      }
    }
    if (!this.enabled || this.loopCancel !== null) {
      return
    }
    if (this.applied) {
      this.startLoop()
    } else {
      this.state.heldForApproval = true
      this.pendingRound = this.round(true)
    }
  }

  snapshot(): GrazrSyncSnapshot {
    return {
      enabled: this.enabled,
      applied: this.applied,
      devices: this.deps.listDevices().map((device) => ({
        ...device,
        included: !this.state.excluded.has(device.key),
        runsGrazr: this.state.reports.has(device.key)
      })),
      status: this.state.status
    }
  }

  /** On shows what the first round would do and pushes nothing until apply (nothing to approve
   *  starts the sync at once); off stops the loop and forgets everything seen. On while already
   *  syncing changes nothing. */
  setEnabled(on: boolean): GrazrSyncSnapshot {
    if (on && this.enabled && this.loopCancel !== null) {
      return this.snapshot()
    }
    this.enabled = on
    this.applied = false
    this.generation += 1
    this.loopCancel?.()
    this.loopCancel = null
    // The reports stay: what each host runs is known already.
    this.state = { ...freshState(this.state.excluded), reports: this.state.reports }
    if (on) {
      this.pendingRound = this.round(true)
    }
    void this.save()
    return this.publish()
  }

  /** Runs the preview's pushes, then keeps the devices in step. The round reads every device
   *  again first, so a change made since the preview still wins. */
  apply(): GrazrSyncSnapshot {
    if (this.enabled) {
      this.markApplied()
      this.startLoop()
    }
    return this.snapshot()
  }

  /** Leaves a device out of the sync, or lets it back in. One left out is neither read nor pushed;
   *  if it led, a device already in step takes over. One let back in follows: what it did while out
   *  is not a change that wins. */
  setIncluded(key: string, on: boolean): GrazrSyncSnapshot {
    const { state } = this
    if (on) {
      state.excluded.delete(key)
      // Before Apply the preview plans afresh, so no baseline is needed.
      if (this.enabled && this.applied) {
        state.unsettled.add(key)
      }
    } else {
      state.excluded.add(key)
      state.planner.forget(key)
      state.problems.delete(key)
      state.unsettled.delete(key)
      state.unconfirmed.delete(key)
    }
    void this.save()
    this.kick()
    return this.publish()
  }

  /** One round now. Before Apply it only refreshes the preview. */
  kick(): void {
    if (!this.enabled) {
      return
    }
    if (this.loopCancel !== null) {
      this.pendingRound = this.round(false)
    } else if (!this.applied && this.state.status.kind !== 'off') {
      this.pendingRound = this.round(true)
    }
  }

  dispose(): void {
    this.generation += 1
    this.loopCancel?.()
    this.loopCancel = null
  }

  private publish(): GrazrSyncSnapshot {
    const snapshot = this.snapshot()
    this.deps.broadcast(snapshot)
    return snapshot
  }

  private markApplied(): void {
    this.applied = true
    this.state.heldForApproval = false
    void this.save()
  }

  private save(): Promise<void> {
    return this.deps
      .save({
        enabled: this.enabled,
        applied: this.applied,
        excluded: [...this.state.excluded].sort(),
        planner: this.applied ? this.state.planner.snapshot() : null,
        unsettled: [...this.state.unsettled].sort()
      })
      .catch(() => undefined)
  }

  // A round now unless the caller is in one, then one each interval.
  private startLoop(roundNow = true): void {
    this.loopCancel?.()
    const generation = this.generation
    let cancelTimer: (() => void) | null = null
    let cancelled = false
    const tick = (): void => {
      if (cancelled || generation !== this.generation) {
        return
      }
      cancelTimer = this.deps.setTimer(() => {
        void this.round(false).then(tick)
      }, this.deps.intervalMs)
    }
    this.loopCancel = () => {
      cancelled = true
      cancelTimer?.()
    }
    const first = roundNow ? this.round(false) : Promise.resolve()
    if (roundNow) {
      this.pendingRound = first
    }
    void first.then(tick)
  }

  // A round already running is not entered again; it runs once more after.
  private async round(preview: boolean): Promise<void> {
    if (this.running) {
      this.runAgain = true
      return
    }
    this.running = true
    const generation = this.generation
    try {
      let asPreview = preview
      do {
        this.runAgain = false
        await runGrazrSyncRound(
          this.state,
          {
            ...this.deps,
            generation: () => this.generation,
            startSyncing: () => {
              this.markApplied()
              this.startLoop(false)
            },
            save: () => this.save(),
            publish: () => {
              this.publish()
            }
          },
          asPreview,
          generation
        )
        asPreview = this.loopCancel === null
      } while (this.runAgain && this.enabled)
    } finally {
      this.running = false
    }
  }
}
