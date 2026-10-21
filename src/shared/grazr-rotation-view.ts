import type { GrazrHostOutcome } from './grazr-api-types'
import type {
  GrazrSnapshotEntry,
  GrazrStatusAccount,
  GrazrStatusReport
} from './grazr-status-report'

// A port of the plugin's lib/panel-data.mjs. The engine's rotation rules live in its core.py;
// this mirrors them so the dialog and menu can show what the engine will do next.

export type GrazrWindowView = 'session' | 'weekly'
type Thresholds = GrazrStatusReport['settings']['thresholds']
type Settings = GrazrStatusReport['settings']

// An ordered name with no record, so the view can say not enrolled.
export type GrazrMissingAccount = { missing: true; name: string }
export type GrazrAccountEntry = GrazrStatusAccount | GrazrMissingAccount

export type GrazrRowStatus =
  | 'active'
  | 'next'
  | 'spent'
  | 'blocked'
  | 'not-enrolled'
  | 'unread'
  | 'ok'
export type GrazrSegmentState = 'active' | 'next' | 'spent' | 'blocked' | 'ok' | 'unknown'

export type GrazrRotationCentre = { name: string; percentText: string; hint: string; next: string }
export type GrazrRotationRow = {
  index: number
  name: string
  email: string | null
  percent: number | null
  status: GrazrRowStatus
  label: string
  blocked: string | null
  isActive: boolean
  isNext: boolean
}
export type GrazrRingSegment = {
  index: number
  name: string
  remaining: number | null
  state: GrazrSegmentState
}
export type GrazrRotationView = {
  centre: GrazrRotationCentre
  rows: GrazrRotationRow[]
  segments: GrazrRingSegment[]
}

export type GrazrHostChipKind =
  | 'on'
  | 'off'
  | 'not-connected'
  | 'foreign'
  | 'managed'
  | 'not-deployed'
  | 'unreachable'
  | 'no-ssh-access'
  | 'unsupported-platform'
export type GrazrHostChip = { kind: GrazrHostChipKind; label: string }

function isMissing(entry: GrazrAccountEntry): entry is GrazrMissingAccount {
  return 'missing' in entry
}

function blockedReason(account: GrazrStatusAccount): string | null {
  return account.blocked !== null && account.blocked !== '' ? account.blocked : null
}

// The engine's _live: an entry whose reset is at or before now has run out and counts as absent.
// A missing or unreadable reset time stays live, as the engine keeps it.
function isLive(entry: GrazrSnapshotEntry, now: Date): boolean {
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

function thresholdOf(thresholds: Thresholds, group: string): number | null {
  if (group === 'session') {
    return thresholds.session
  }
  if (group === 'weekly') {
    return thresholds.weekly
  }
  return null
}

// The engine's shortfall: the first live entry whose group has a threshold and that sits below it.
// Scoped (per-model) entries count only when modelLimits is on, as the engine's _bound keeps them only then.
// An account with a shortfall is spent, whichever of its windows the view shows.
function shortfallOf(
  snapshot: GrazrSnapshotEntry[] | null,
  thresholds: Thresholds,
  now: Date,
  modelLimits: boolean
): GrazrSnapshotEntry | null {
  return (
    snapshot?.find((e) => {
      const threshold = thresholdOf(thresholds, e.group)
      return (
        threshold !== null &&
        (e.scope === null || modelLimits) &&
        e.remaining !== null &&
        e.remaining < threshold &&
        isLive(e, now)
      )
    }) ?? null
  )
}

// Named accounts come first in the engine's rotation order, then any unordered ones.
// A name in order with no record becomes a placeholder, so the panel can say not enrolled.
export function orderedAccounts(report: GrazrStatusReport): GrazrAccountEntry[] {
  const ordered = report.order.map(
    (name): GrazrAccountEntry =>
      report.accounts.find((a) => a.name === name) ?? { missing: true, name }
  )
  return [...ordered, ...report.accounts.filter((a) => !report.order.includes(a.name))]
}

// The active record, or null when nobody is logged in or the active one is not in the list.
function activeAccount(report: GrazrStatusReport): GrazrStatusAccount | null {
  const id = report.active?.id
  if (id === undefined) {
    return null
  }
  return report.accounts.find((a) => a.id === id) ?? null
}

function isActive(account: GrazrAccountEntry, report: GrazrStatusReport): boolean {
  const active = activeAccount(report)
  return active !== null && !isMissing(account) && account.id === active.id
}

// Eligible for the engine's next_account: parked, not blocked, and no shortfall on any live window.
function eligible(account: GrazrStatusAccount, settings: Settings, now: Date): boolean {
  if (!account.parked || blockedReason(account) !== null) {
    return false
  }
  return shortfallOf(account.snapshot, settings.thresholds, now, settings.model_limits) === null
}

// The engine's next_account: the first account in preference order that is not the active one and is eligible.
// There is no wrap from the active account. With an order set, only named accounts can be next.
export function nextAccount(report: GrazrStatusReport, now: Date): GrazrStatusAccount | null {
  const active = activeAccount(report)
  if (active === null) {
    return null
  }
  for (const candidate of orderedAccounts(report)) {
    if (isMissing(candidate) || candidate.id === active.id) {
      continue
    }
    if (report.order.length > 0 && !report.order.includes(candidate.name)) {
      continue
    }
    if (eligible(candidate, report.settings, now)) {
      return candidate
    }
  }
  return null
}

// The engine's reset time, shown in the given zone so tests can pin it.
function formatReset(iso: string | null, timeZone: string | undefined): string | null {
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

export function rowState(
  account: GrazrAccountEntry,
  report: GrazrStatusReport,
  view: GrazrWindowView,
  { timeZone, now }: { timeZone?: string; now: Date }
): { percent: number | null; status: GrazrRowStatus; label: string } {
  if (isMissing(account)) {
    return { percent: null, status: 'not-enrolled', label: 'not enrolled' }
  }
  const live = windowOf(account.snapshot, view, now)
  const percent = live ? Math.round(live.remaining) : null
  const reason = blockedReason(account)
  if (isActive(account, report)) {
    return { percent, status: 'active', label: reason ? `active · blocked: ${reason}` : 'active' }
  }
  // A blocked account cannot be rotated to, so it shows no percent whatever its snapshot says.
  if (reason) {
    return { percent: null, status: 'blocked', label: `blocked: ${reason}` }
  }
  const next = nextAccount(report, now)
  if (next !== null && account.id === next.id) {
    return { percent, status: 'next', label: 'NEXT ▸' }
  }
  // Spent on either window, so a row never reads ok while the other window is below its threshold.
  // The reset time shown is the binding window's.
  const binding = shortfallOf(
    account.snapshot,
    report.settings.thresholds,
    now,
    report.settings.model_limits
  )
  if (binding) {
    const resets = formatReset(binding.resets_at, timeZone)
    return { percent, status: 'spent', label: resets ? `spent · resets ${resets}` : 'spent' }
  }
  if (!live) {
    return { percent, status: 'unread', label: 'not read yet' }
  }
  return { percent, status: 'ok', label: '' }
}

export function centre(
  report: GrazrStatusReport,
  view: GrazrWindowView,
  { now }: { now: Date }
): GrazrRotationCentre {
  const active = activeAccount(report)
  const next = nextAccount(report, now)
  const nextLabel = `next ▸ ${next !== null ? next.name : 'none'}`
  if (active === null) {
    return { name: '—', percentText: '—', hint: 'no active login', next: nextLabel }
  }
  const live = windowOf(active.snapshot, view, now)
  const percentText = live ? `${Math.round(live.remaining)}% left` : '—'
  const reason = blockedReason(active)
  let hint = 'fine'
  if (reason) {
    hint = `blocked: ${reason}`
  } else if (
    shortfallOf(active.snapshot, report.settings.thresholds, now, report.settings.model_limits)
  ) {
    hint = 'below the threshold, swaps next turn'
  } else if (!live) {
    hint = 'not read yet'
  }
  return { name: active.name, percentText, hint, next: nextLabel }
}

const SEGMENT_STATE: Record<GrazrRowStatus, GrazrSegmentState> = {
  active: 'active',
  next: 'next',
  spent: 'spent',
  blocked: 'blocked',
  ok: 'ok',
  unread: 'unknown',
  'not-enrolled': 'unknown'
}

export function buildGrazrRotationView(
  report: GrazrStatusReport,
  view: GrazrWindowView,
  now: Date,
  timeZone?: string
): GrazrRotationView {
  const rows: GrazrRotationRow[] = []
  const segments: GrazrRingSegment[] = []
  orderedAccounts(report).forEach((account, i) => {
    const state = rowState(account, report, view, { timeZone, now })
    const index = i + 1
    rows.push({
      index,
      name: account.name,
      email: isMissing(account) ? null : account.email,
      percent: state.percent,
      status: state.status,
      label: state.label,
      blocked: isMissing(account) ? null : blockedReason(account),
      isActive: state.status === 'active',
      isNext: state.status === 'next'
    })
    const remaining =
      isMissing(account) || state.status === 'blocked'
        ? null
        : (windowOf(account.snapshot, view, now)?.remaining ?? null)
    segments.push({ index, name: account.name, remaining, state: SEGMENT_STATE[state.status] })
  })
  return { centre: centre(report, view, { now }), rows, segments }
}

// Failures are checked first; a chip can only be one state, so a conflict outranks the on/off state.
// A host whose status line or hook is disconnected reports installed false, and nothing rotates there whatever the setting says.
export function grazrHostChip(outcome: GrazrHostOutcome): GrazrHostChip {
  switch (outcome.kind) {
    case 'not-deployed':
      return { kind: 'not-deployed', label: 'engine not installed' }
    case 'no-ssh-access':
      return { kind: 'no-ssh-access', label: 'no SSH access' }
    case 'unsupported-platform':
      return { kind: 'unsupported-platform', label: 'unsupported platform' }
    case 'unreachable':
      return { kind: 'unreachable', label: 'unreachable' }
    case 'engine-error':
      return { kind: 'unreachable', label: 'engine error' }
    case 'ok':
      return reportChip(outcome.report)
  }
}

function reportChip(report: GrazrStatusReport): GrazrHostChip {
  if (report.connection.foreign?.statusline) {
    return { kind: 'foreign', label: 'another grazr owns the status line' }
  }
  if (report.managed_profile) {
    return { kind: 'managed', label: 'managed profile' }
  }
  if (report.installed === false) {
    return { kind: 'not-connected', label: 'not connected' }
  }
  return report.settings.enabled
    ? { kind: 'on', label: 'rotation on' }
    : { kind: 'off', label: 'rotation off' }
}
