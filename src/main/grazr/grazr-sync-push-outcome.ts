import type { GrazrActionResult } from '../../shared/grazr-api-types'
import { translateMain } from '../i18n/main-i18n'
import type { GrazrSyncMember, GrazrSyncProblem } from './grazr-sync-planner'
import type { GrazrSyncAnswered, GrazrSyncRoundDeps } from './grazr-sync-round'

// What came of one push: the engine's answer read as a problem, and a switch confirmed by the
// device's next report.

// What a grazr from before `set ACCOUNTS` answers with.
export const NEEDS_UPDATE_MARKER = 'can be set this way'

/** Why grazr refused a switch. "Busy rotating" stays a refusal; the planner treats it as passing. */
export function problemFrom(message: string, accountId: string): GrazrSyncProblem {
  if (message.includes(NEEDS_UPDATE_MARKER)) {
    return { kind: 'needs-update' }
  }
  if (message.includes('failed with')) {
    return { kind: 'blocked', accountId, reason: message }
  }
  return { kind: 'refused', text: message }
}

export async function attempt(run: () => Promise<GrazrActionResult>): Promise<GrazrActionResult> {
  try {
    return await run()
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

// A switch grazr answered ok counts once the device's report is on the account: notified then.
// grazr with DRY_RUN=1 answers ok and stays put, which is a refusal in its words.
export function confirm(
  deps: Pick<GrazrSyncRoundDeps, 'notify'>,
  answered: GrazrSyncAnswered,
  member: GrazrSyncMember
): GrazrSyncProblem | null {
  if (member.report.active?.id !== answered.account) {
    return {
      kind: 'refused',
      text: answered.summary || translateMain('grazr.sync.didNotMove', 'did not move')
    }
  }
  const name =
    member.report.accounts.find((a) => a.id === answered.account)?.name ?? answered.account
  deps.notify(
    translateMain('grazr.sync.nowOn', 'grazr: {{device}} now on {{account}}', {
      device: member.name,
      account: name
    }),
    translateMain('grazr.sync.following', 'following {{source}}', { source: answered.sourceName })
  )
  return null
}
