import type { GrazrStatusReport } from '../../shared/grazr-status-report'

// One device's rotation as the sync compares it: ACCOUNTS as account ids, and the account Claude
// is on. Ids, not names, because each device names its accounts itself. A port of HerdrM's
// GrazrSyncState.
export type GrazrSyncState = {
  orderIds: string[]
  activeId: string | null
  // When the device's rotation last changed (epoch seconds).
  changedAt: number | null
}

/** The first of each element, in order. */
export function uniqued<T>(values: readonly T[]): T[] {
  const seen = new Set<T>()
  return values.filter((value) => (seen.has(value) ? false : (seen.add(value), true)))
}

// A name in ACCOUNTS that no enrolled account has drops out. Without ACCOUNTS grazr rotates
// through every account, here sorted by name.
export function syncStateOf(report: GrazrStatusReport): GrazrSyncState {
  const ids = new Map<string, string>()
  for (const account of report.accounts) {
    if (!ids.has(account.name)) {
      ids.set(account.name, account.id)
    }
  }
  const orderIds =
    report.order.length === 0
      ? uniqued([...report.accounts].sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.id))
      : uniqued(report.order.flatMap((name) => ids.get(name) ?? []))
  return { orderIds, activeId: report.active?.id ?? null, changedAt: report.changed_at }
}

/** Same active account, and the orders agree on the accounts both list: an account only one
 *  device has is no difference. */
export function sameSyncState(a: GrazrSyncState, b: GrazrSyncState): boolean {
  if (a.activeId !== b.activeId) {
    return false
  }
  const common = new Set(a.orderIds.filter((id) => b.orderIds.includes(id)))
  const left = a.orderIds.filter((id) => common.has(id))
  const right = b.orderIds.filter((id) => common.has(id))
  return left.length === right.length && left.every((id, i) => id === right[i])
}
