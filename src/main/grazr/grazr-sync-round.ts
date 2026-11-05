import type { GrazrApi } from '../../shared/grazr-api-types'
import type { GrazrStatusReport } from '../../shared/grazr-status-report'
import type { GrazrSyncStatus } from '../../shared/grazr-sync-types'
import type { GrazrSyncDeviceRef } from './grazr-sync-devices'
import { grazrSyncLines } from './grazr-sync-lines'
import {
  GrazrSyncPlanner,
  type GrazrSyncMember,
  type GrazrSyncProblem,
  type GrazrSyncPush
} from './grazr-sync-planner'
import { attempt, confirm, NEEDS_UPDATE_MARKER, problemFrom } from './grazr-sync-push-outcome'
import { sameSyncState, syncStateOf } from './grazr-sync-state'

// One round of the account sync: read every device, plan, push, and write the dialog's lines. The
// coordinator owns the state and the loop; this is the body of a round.

// A switch that answered ok: confirmed once the device's report is on the account.
export type GrazrSyncAnswered = { account: string; summary: string; sourceName: string }

export type GrazrSyncRoundState = {
  planner: GrazrSyncPlanner
  // Each device's last readable report; a device that could not be read keeps its last one.
  reports: Map<string, GrazrStatusReport>
  // What each device last could not do, kept until it follows or a push says otherwise.
  problems: Map<string, GrazrSyncProblem>
  // Any command ran since the option went on. Until then the devices agreed by themselves.
  pushedAnything: boolean
  // Pushed devices whose reread failed: settled at their next read.
  unsettled: Set<string>
  // Switches that answered ok on a device that could not be reread: the next read says whether they landed.
  unconfirmed: Map<string, GrazrSyncAnswered>
  // A preview with moves was shown since the option went on: a lone device then no longer counts as nothing to approve.
  heldForApproval: boolean
  excluded: Set<string>
  status: GrazrSyncStatus
}

export type GrazrSyncRoundDeps = {
  grazr: Pick<GrazrApi, 'status' | 'setAccounts' | 'swap'>
  listDevices: () => GrazrSyncDeviceRef[]
  now: () => number
  notify: (title: string, body: string) => void
  // The coordinator's generation: a round from before an on/off stops pushing.
  generation: () => number
  // The first enable with nothing to approve starts the sync at once.
  startSyncing: () => void
  save: () => Promise<void>
  publish: () => void
}

/** Reads a device's grazr; false when it could not be read, which leaves its last report in place. */
export async function loadGrazrReport(
  state: GrazrSyncRoundState,
  deps: GrazrSyncRoundDeps,
  device: GrazrSyncDeviceRef
): Promise<boolean> {
  try {
    const { outcome } = await deps.grazr.status(device.host)
    if (outcome.kind === 'ok') {
      if (outcome.report.installed === false) {
        state.reports.delete(device.key)
      } else {
        state.reports.set(device.key, outcome.report)
      }
      return true
    }
    if (outcome.kind === 'not-deployed' || outcome.kind === 'unsupported-platform') {
      state.reports.delete(device.key)
      return true
    }
    return false
  } catch {
    return false
  }
}

function membersOf(state: GrazrSyncRoundState, devices: GrazrSyncDeviceRef[]): GrazrSyncMember[] {
  return devices.flatMap((device) => {
    const report = state.reports.get(device.key)
    return report === undefined ? [] : [{ key: device.key, name: device.name, report }]
  })
}

// Order first, then the switch. Returns what got in the way, if anything. A push that outlives an
// on/off leaves the new planner alone.
async function execute(
  state: GrazrSyncRoundState,
  deps: GrazrSyncRoundDeps,
  push: GrazrSyncPush,
  device: GrazrSyncDeviceRef,
  sourceName: string,
  generation: number
): Promise<GrazrSyncProblem | null> {
  let orderProblem: GrazrSyncProblem | null = null
  let switchProblem = push.problem
  let ran = false
  let answered: GrazrSyncAnswered | null = null
  const names = push.orderNames
  if (names !== null) {
    ran = true
    const result = await attempt(() => deps.grazr.setAccounts(device.host, names))
    if (!result.ok) {
      orderProblem = result.message.includes(NEEDS_UPDATE_MARKER)
        ? { kind: 'needs-update' }
        : { kind: 'refused', text: result.message }
    }
  }
  const account = push.switchTo
  if (account !== null && generation === deps.generation()) {
    ran = true
    const name = state.reports.get(device.key)?.accounts.find((a) => a.id === account)?.name
    if (name === undefined) {
      switchProblem = { kind: 'not-enrolled', accountId: account }
    } else {
      const result = await attempt(() => deps.grazr.swap(device.host, name))
      if (result.ok) {
        answered = { account, summary: result.message, sourceName }
      } else {
        switchProblem = problemFrom(result.message, account)
      }
    }
  }
  // Unread after the push: its state stays unknown, not the old one.
  const reread = ran ? await loadGrazrReport(state, deps, device) : false
  if (generation !== deps.generation()) {
    return switchProblem ?? orderProblem
  }
  if (ran) {
    state.pushedAnything = true
  }
  const report = reread ? state.reports.get(device.key) : undefined
  if (report !== undefined) {
    state.unsettled.delete(device.key)
    const member = { key: device.key, name: device.name, report }
    state.planner.settle(member)
    if (answered !== null) {
      switchProblem = confirm(deps, answered, member)
    }
  } else if (ran) {
    state.unsettled.add(device.key)
    if (answered !== null) {
      state.unconfirmed.set(device.key, answered)
    }
  }
  const problem = switchProblem ?? orderProblem
  state.planner.recordResult(device.key, problem, deps.now())
  return problem
}

// What the first round would do, shown for approval when anything would move.
function preview(state: GrazrSyncRoundState, members: GrazrSyncMember[], now: number): boolean {
  const copy = GrazrSyncPlanner.restore(state.planner.snapshot())
  const pushes = copy.observe(members, now)
  const moves = pushes.filter((push) => push.orderNames !== null || push.switchTo !== null)
  if (moves.length === 0 && !state.heldForApproval) {
    return false
  }
  state.heldForApproval = true
  const found = new Map(
    pushes.flatMap((push) => (push.problem === null ? [] : [[push.device, push.problem] as const]))
  )
  state.status = {
    kind: 'preview',
    lines: grazrSyncLines({
      planner: copy,
      pushes,
      results: found,
      pushedAnything: state.pushedAnything,
      members,
      now
    }),
    moves: moves.length
  }
  return true
}

export async function runGrazrSyncRound(
  state: GrazrSyncRoundState,
  deps: GrazrSyncRoundDeps,
  asPreview: boolean,
  generation: number
): Promise<void> {
  const group = deps.listDevices().filter((device) => !state.excluded.has(device.key))
  // A device that cannot be read sits this round out with its last state.
  const unread = new Set<string>()
  for (const device of group) {
    if (!(await loadGrazrReport(state, deps, device))) {
      unread.add(device.key)
    }
  }
  if (generation !== deps.generation()) {
    return
  }
  const known = membersOf(state, group)
  if (known.length < 2) {
    // One device at enable: nothing to approve, the sync waits for a second. Not so once moves
    // were shown, or for a launch that has not met every device yet.
    if (asPreview && !state.heldForApproval) {
      deps.startSyncing()
    }
    state.status = { kind: 'few-devices', name: known[0]?.name ?? null }
    deps.publish()
    return
  }
  const members = known.filter((member) => !unread.has(member.key))
  if (members.length < 2) {
    return
  }
  const now = deps.now()
  if (asPreview) {
    if (preview(state, members, now)) {
      deps.publish()
      return
    }
    // Nothing would move: the first enable with nothing to move starts at once.
    deps.startSyncing()
  }

  // Read again since a push whose reread failed: what it finds is that push.
  for (const member of members) {
    if (state.unsettled.delete(member.key)) {
      state.planner.settle(member)
    }
    const pending = state.unconfirmed.get(member.key)
    if (pending !== undefined) {
      state.unconfirmed.delete(member.key)
      const problem = confirm(deps, pending, member)
      if (problem !== null) {
        state.planner.recordResult(member.key, problem, now)
        state.problems.set(member.key, problem)
      }
    }
  }
  const pushes = state.planner.observe(members, now)
  const source = state.planner.target?.source
  const sourceName = members.find((m) => m.key === source)?.name ?? ''
  for (const push of pushes) {
    const device = group.find((d) => d.key === push.device)
    if (
      push.device === source ||
      generation !== deps.generation() ||
      state.excluded.has(push.device) ||
      device === undefined
    ) {
      continue
    }
    const problem = await execute(state, deps, push, device, sourceName, generation)
    if (generation === deps.generation()) {
      if (problem === null) {
        state.problems.delete(push.device)
      } else {
        state.problems.set(push.device, problem)
      }
    }
  }
  if (generation !== deps.generation()) {
    return
  }

  const inGroup = new Set(known.map((m) => m.key))
  const target = state.planner.target
  const wanted =
    target === null
      ? null
      : { orderIds: target.orderIds, activeId: target.activeId, changedAt: null }
  // An unread device keeps its problem; one that follows now loses it.
  for (const key of state.problems.keys()) {
    const report = state.reports.get(key)
    const follows =
      wanted !== null &&
      report !== undefined &&
      !unread.has(key) &&
      sameSyncState(syncStateOf(report), wanted)
    if (!inGroup.has(key) || follows) {
      state.problems.delete(key)
    }
  }
  state.status = {
    kind: 'lines',
    lines: grazrSyncLines({
      planner: state.planner,
      pushes: [],
      results: state.problems,
      pushedAnything: state.pushedAnything,
      members: membersOf(state, group),
      now
    })
  }
  await deps.save()
  deps.publish()
}
