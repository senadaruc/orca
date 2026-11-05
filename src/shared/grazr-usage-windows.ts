import type { GrazrSnapshotEntry, GrazrStatusReport } from './grazr-status-report'

// The usage windows the engine reads off Claude's status line and usage endpoint: the 5-hour
// window, the all-models week, and a week per model with a limit of its own ("Fable").

export type GrazrWindowView = 'session' | 'weekly'
export type GrazrThresholds = GrazrStatusReport['settings']['thresholds']

// One usage window of an account, as HerdrM's account card draws it: a bar with what is left.
export type GrazrWindowTone = 'fine' | 'warning' | 'spent'
export type GrazrWindowBar = {
  label: string
  left: number
  tone: GrazrWindowTone
  resetText: string
}

// The engine's _live: an entry whose reset is at or before now has run out and counts as absent.
// A missing or unreadable reset time stays live, as the engine keeps it.
export function isLive(entry: GrazrSnapshotEntry, now: Date): boolean {
  if (entry.resets_at === null) {
    return true
  }
  const at = Date.parse(entry.resets_at)
  return Number.isNaN(at) || at > now.getTime()
}

// The window a view shows: the account-wide entry of its group (scope null, as the engine reports it), if still live.
// A per-model weekly entry is never the one shown.
export function windowOf(
  snapshot: GrazrSnapshotEntry[] | null,
  view: GrazrWindowView,
  now: Date
): { remaining: number; resets_at: string | null } | null {
  const entry = snapshot?.find((e) => e.group === view && e.scope === null && isLive(e, now))
  if (entry === undefined || entry.remaining === null) {
    return null
  }
  return { remaining: entry.remaining, resets_at: entry.resets_at }
}
// HerdrM's modelScopes: every model that carries a weekly limit of its own on any account, by name.
export function modelScopes(report: GrazrStatusReport): string[] {
  const scopes = new Set<string>()
  for (const account of report.accounts) {
    for (const entry of account.snapshot ?? []) {
      if (entry.group === 'weekly' && entry.scope !== null) {
        scopes.add(entry.scope)
      }
    }
  }
  return [...scopes].sort()
}

// The per-model week of one account: what is left while it is open, all of it after its reset.
export function modelWindowLeft(
  snapshot: GrazrSnapshotEntry[] | null,
  scope: string,
  now: Date
): number | null {
  const entry = snapshot?.find((e) => e.group === 'weekly' && e.scope === scope)
  if (entry === undefined || entry.remaining === null) {
    return null
  }
  return isLive(entry, now) ? Math.round(entry.remaining) : 100
}

// HerdrM's GrazrStyle.tint: 2% or less is spent, below the threshold warns, the rest is fine.
function windowTone(left: number, threshold: number | null): GrazrWindowTone {
  if (left <= 2) {
    return 'spent'
  }
  if (threshold !== null && left < threshold) {
    return 'warning'
  }
  return 'fine'
}

function windowLabel(entry: GrazrSnapshotEntry): string {
  if (entry.group === 'session') {
    return '5h'
  }
  if (entry.group === 'weekly') {
    return entry.scope === null ? 'Week' : `${entry.scope} week`
  }
  return entry.group
}

// HerdrM's sortedWindows: the 5-hour window, then the all-models week, then the per-model weeks by name.
function windowRank(entry: GrazrSnapshotEntry): [number, string] {
  if (entry.group === 'session') {
    return [0, '']
  }
  return entry.group === 'weekly' && entry.scope === null ? [1, ''] : [2, entry.scope ?? '']
}

// HerdrM's account card: one bar per window with a reading. A window past its reset has refilled.
export function windowBars(
  snapshot: GrazrSnapshotEntry[] | null,
  thresholds: GrazrThresholds,
  now: Date,
  timeZone?: string
): GrazrWindowBar[] {
  return (snapshot ?? [])
    .filter((entry) => entry.remaining !== null)
    .sort((a, b) => {
      const [ra, sa] = windowRank(a)
      const [rb, sb] = windowRank(b)
      return ra - rb || sa.localeCompare(sb)
    })
    .map((entry) => {
      const open = isLive(entry, now)
      const left = open ? Math.round(entry.remaining ?? 0) : 100
      const resets = formatReset(entry.resets_at, timeZone)
      return {
        label: windowLabel(entry),
        left,
        tone: windowTone(left, thresholdOf(thresholds, entry.group)),
        resetText: resets === null ? '' : open ? `resets ${resets}` : 'reset since'
      }
    })
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60]
]

// "1 wk. ago", "5 min. ago", "just now" below a minute: how old a reading is.
export function relativeAge(epochSeconds: number, now: Date): string {
  const elapsed = Math.max(0, now.getTime() / 1000 - epochSeconds)
  const format = new Intl.RelativeTimeFormat('en', { style: 'short', numeric: 'always' })
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (elapsed >= seconds) {
      return format.format(-Math.floor(elapsed / seconds), unit)
    }
  }
  return 'just now'
}

export function thresholdOf(thresholds: GrazrThresholds, group: string): number | null {
  if (group === 'session') {
    return thresholds.session
  }
  if (group === 'weekly') {
    return thresholds.weekly
  }
  return null
}
// The engine's reset time, shown in the given zone so tests can pin it.
export function formatReset(iso: string | null, timeZone: string | undefined): string | null {
  if (iso === null) {
    return null
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  // h23 rather than hour12:false, which some engines render as 24:00 at midnight.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone
  }).format(date)
}
