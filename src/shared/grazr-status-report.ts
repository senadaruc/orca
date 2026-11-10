import { z } from 'zod'

// The engine's `status --json`. Parsed leniently: an unknown field is ignored and a missing or
// malformed one takes its empty value, so an older or broken engine still renders.

// Parses each list item on its own and drops the ones that do not fit, rather than failing the list.
function listOf<Output>(item: z.ZodType<Output>) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((values) =>
      values.flatMap((value) => {
        const parsed = item.safeParse(value)
        return parsed.success ? [parsed.data] : []
      })
    )
}

const SnapshotEntrySchema = z.object({
  kind: z.string().catch(''),
  scope: z.string().nullable().catch(null),
  group: z.string().catch(''),
  remaining: z.number().nullable().catch(null),
  resets_at: z.string().nullable().catch(null)
})

// The subscription, from the account's OAuth profile: organizationType, organizationRateLimitTier, userRateLimitTier.
const PlanSchema = z.object({
  type: z.string(),
  tier: z.string().nullable().catch(null),
  seat_tier: z.string().nullable().catch(null)
})

const AccountSchema = z.object({
  id: z.string(),
  name: z.string().catch(''),
  email: z.string().nullable().catch(null),
  organization: z.string().nullable().catch(null),
  plan: PlanSchema.nullable().catch(null),
  // When the engine last wrote this account's reading, in epoch seconds.
  updated: z.number().nullable().catch(null),
  parked: z.boolean().catch(false),
  in_order: z.boolean().catch(false),
  first_reading_due: z.boolean().catch(false),
  blocked: z.string().nullable().catch(null),
  // Claude Code's own note of an unused limit reset; null when it made none, or the note has lapsed.
  unused_reset: z.object({ holds: z.boolean() }).nullable().catch(null),
  snapshot: z
    .unknown()
    .optional()
    .transform((value) => (Array.isArray(value) ? listOf(SnapshotEntrySchema).parse(value) : null))
})

const ReportSchema = z.object({
  version: z.string().nullable().catch(null),
  // Null when the engine does not say; the chip reads that as connected, as the engine always did.
  installed: z.boolean().nullable().catch(null),
  // The engine reports the managed config path, or null; a path or true both mean a managed profile.
  managed_profile: z
    .union([z.string(), z.boolean(), z.null()])
    .transform((value) => value === true || (typeof value === 'string' && value.length > 0))
    .catch(false),
  connection: z
    .object({
      statusline: z.string().nullable().catch(null),
      failure_hook: z.string().nullable().catch(null),
      foreign: z
        .object({ statusline: z.string().nullable().catch(null) })
        .nullable()
        .catch(null)
    })
    .catch({ statusline: null, failure_hook: null, foreign: null }),
  active: z
    .object({ id: z.string(), name: z.string().catch('') })
    .nullable()
    .catch(null),
  accounts: listOf(AccountSchema),
  order: listOf(z.string()),
  // When this host's rotation last changed (epoch seconds): the newer of a config write and the last swap.
  changed_at: z.number().nullable().catch(null),
  settings: z
    .object({
      enabled: z.boolean().catch(false),
      model_limits: z.boolean().catch(false),
      thresholds: z
        .object({ session: z.number().catch(0), weekly: z.number().catch(0) })
        .catch({ session: 0, weekly: 0 })
    })
    .catch({ enabled: false, model_limits: false, thresholds: { session: 0, weekly: 0 } })
})

export type GrazrStatusReport = z.infer<typeof ReportSchema>
export type GrazrStatusAccount = z.infer<typeof AccountSchema>
export type GrazrSnapshotEntry = z.infer<typeof SnapshotEntrySchema>
export type GrazrPlan = z.infer<typeof PlanSchema>

const PLAN_NAMES: Record<string, string> = {
  claude_pro: 'Pro',
  claude_max: 'Max',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise'
}

// "5x" from "default_claude_max_5x".
function multiplierOf(tier: string | null): string | null {
  const last = tier?.split('_').at(-1)
  return last !== undefined && /^\d+x$/.test(last) ? last : null
}

/** "Pro", "Max 20x", "Team 5x": the plan with its usage multiplier, the seat's own before the organization's. */
export function grazrPlanLabel(plan: GrazrPlan): string {
  const name =
    PLAN_NAMES[plan.type] ??
    plan.type
      .replace(/^claude_/, '')
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  const multiplier = multiplierOf(plan.seat_tier) ?? multiplierOf(plan.tier)
  return multiplier === null ? name : `${name} ${multiplier}`
}

/** Null when the text is not a JSON object; a JSON object that lacks fields still parses. */
export function parseGrazrStatusReport(text: string): GrazrStatusReport | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = ReportSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
