import {
  grazrPlanLabel,
  type GrazrSnapshotEntry,
  type GrazrStatusAccount,
  type GrazrStatusReport
} from './grazr-status-report'
import {
  formatReset,
  isLive,
  modelScopes,
  modelWindowLeft,
  relativeAge,
  thresholdOf,
  windowBars,
  windowOf,
  type GrazrThresholds,
  type GrazrWindowBar,
  type GrazrWindowView
} from './grazr-usage-windows'

export { modelScopes, relativeAge, windowBars, windowOf }
export type {
  GrazrThresholds,
  GrazrWindowBar,
  GrazrWindowTone,
  GrazrWindowView
} from './grazr-usage-windows'

// A port of the plugin's lib/panel-data.mjs. The engine's rotation rules live in its core.py;
// this mirrors them so the dialog and menu can show what the engine will do next.

type Thresholds = GrazrThresholds
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

// Why: the centre percentage takes the colour of the active account's state.
export type GrazrCentreTone = 'fine' | 'warning' | 'spent' | 'blocked' | 'none'
export type GrazrRotationCentre = {
  name: string
  percentText: string
  // The active account's per-model weeks ("Fable 100% left"), on the weekly view.
  modelLines: string[]
  hint: string
  next: string | null
  tone: GrazrCentreTone
}
export type GrazrRotationRow = {
  index: number
  name: string
  email: string | null
  organization: string | null
  plan: string | null
  // "1 wk. ago": when the engine last read this account, relative to now.
  readingFrom: string | null
  windows: GrazrWindowBar[]
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
  // What is left of each per-model week, by scope, for the inner rings; null without a reading.
  models: Record<string, number | null>
  state: GrazrSegmentState
}
export type GrazrRotationView = {
  centre: GrazrRotationCentre
  rows: GrazrRotationRow[]
  segments: GrazrRingSegment[]
  // The models with a weekly limit of their own ("Fable"), one inner ring each; only on the weekly view.
  modelScopes: string[]
}

function isMissing(entry: GrazrAccountEntry): entry is GrazrMissingAccount {
  return 'missing' in entry
}

function blockedReason(account: GrazrStatusAccount): string | null {
  return account.blocked !== null && account.blocked !== '' ? account.blocked : null
}

// The engine's shortfall: the first live entry whose group has a threshold and that sits below it.
// Scoped (per-model) entries count only when modelLimits is on, as the engine's _bound keeps them only then.
// An account with a shortfall is spent, whichever of its windows the view shows.
export function shortfallOf(
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
  const nextName = next?.name ?? null
  if (active === null) {
    return {
      name: '—',
      percentText: '—',
      modelLines: [],
      hint: 'no active login',
      next: nextName,
      tone: 'none'
    }
  }
  const live = windowOf(active.snapshot, view, now)
  const percentText = live ? `${Math.round(live.remaining)}% left` : '—'
  // Per-model limits are weekly, so the 5h view names none.
  const modelLines =
    view === 'weekly'
      ? modelScopes(report).flatMap((scope) => {
          const left = modelWindowLeft(active.snapshot, scope, now)
          return left === null ? [] : [`${scope} ${left}% left`]
        })
      : []
  const reason = blockedReason(active)
  let hint = 'fine'
  let tone: GrazrCentreTone = 'fine'
  if (reason) {
    hint = `blocked: ${reason}`
    tone = 'blocked'
  } else if (
    shortfallOf(active.snapshot, report.settings.thresholds, now, report.settings.model_limits)
  ) {
    hint = 'below the threshold, swaps next turn'
    tone = live && live.remaining <= 0 ? 'spent' : 'warning'
  } else if (!live) {
    hint = 'not read yet'
    tone = 'none'
  }
  return { name: active.name, percentText, modelLines, hint, next: nextName, tone }
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
  const scopes = view === 'weekly' ? modelScopes(report) : []
  orderedAccounts(report).forEach((account, i) => {
    const state = rowState(account, report, view, { timeZone, now })
    const index = i + 1
    const record = isMissing(account) ? null : account
    rows.push({
      index,
      name: account.name,
      email: record?.email ?? null,
      organization: record?.organization ?? null,
      plan: record?.plan ? grazrPlanLabel(record.plan) : null,
      readingFrom: record?.updated != null ? relativeAge(record.updated, now) : null,
      windows: record ? windowBars(record.snapshot, report.settings.thresholds, now, timeZone) : [],
      percent: state.percent,
      status: state.status,
      label: state.label,
      blocked: record ? blockedReason(record) : null,
      isActive: state.status === 'active',
      isNext: state.status === 'next'
    })
    // A blocked account cannot be rotated to, so its rings show nothing whatever its snapshot says.
    const readable = record !== null && state.status !== 'blocked'
    const remaining = readable ? (windowOf(record.snapshot, view, now)?.remaining ?? null) : null
    const models = Object.fromEntries(
      scopes.map((scope) => [scope, readable ? modelWindowLeft(record.snapshot, scope, now) : null])
    )
    segments.push({
      index,
      name: account.name,
      remaining,
      models,
      state: SEGMENT_STATE[state.status]
    })
  })
  return { centre: centre(report, view, { now }), rows, segments, modelScopes: scopes }
}
