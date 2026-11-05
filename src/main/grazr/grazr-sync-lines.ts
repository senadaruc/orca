import { relativeAge } from '../../shared/grazr-rotation-view'
import type { GrazrSyncLine } from '../../shared/grazr-sync-types'
import { translateMain } from '../i18n/main-i18n'
import type {
  GrazrSyncMember,
  GrazrSyncPlanner,
  GrazrSyncProblem,
  GrazrSyncPush
} from './grazr-sync-planner'
import { sameSyncState, syncStateOf } from './grazr-sync-state'

// The engine version that learned `set ACCOUNTS`.
const SET_ACCOUNTS_SINCE = '0.4.7+senad.4'

/** The dialog's lines: a pause, who follows whom, what a preview would do, and each device's
 *  problem. Before anything was pushed, with nothing to do or report, it reads "All devices in sync".
 *  A port of HerdrM's GrazrSyncCoordinator.lines. */
export function grazrSyncLines(input: {
  planner: GrazrSyncPlanner
  pushes: GrazrSyncPush[]
  results: Map<string, GrazrSyncProblem>
  pushedAnything: boolean
  members: GrazrSyncMember[]
  now: number
}): GrazrSyncLine[] {
  const { planner, pushes, results, pushedAnything, members, now } = input
  const name = (key: string): string => members.find((m) => m.key === key)?.name ?? ''
  const target = planner.target
  const source = target === null ? undefined : members.find((m) => m.key === target.source)
  // An account as `key`'s device calls it, else as the source does.
  const account = (accountId: string | null, key: string): string => {
    if (accountId === null) {
      return translateMain('grazr.sync.noAccount', 'no account')
    }
    const own = members.find((m) => m.key === key)?.report.accounts.find((a) => a.id === accountId)
    return (own ?? source?.report.accounts.find((a) => a.id === accountId))?.name ?? accountId
  }
  const line = (
    id: string,
    text: string,
    tone: GrazrSyncLine['tone'],
    deviceKey: string | null = null,
    blockedAccount: string | null = null
  ): GrazrSyncLine => ({ id, text, tone, deviceKey, blockedAccount })

  const lines: GrazrSyncLine[] = []
  if (planner.bouncing !== null) {
    lines.push(
      line(
        'paused',
        translateMain(
          'grazr.sync.paused',
          'Sync paused: {{a}} and {{b}} keep undoing each other. Check that their thresholds match.',
          { a: name(planner.bouncing.source), b: name(planner.bouncing.follower) }
        ),
        'warning'
      )
    )
  }
  // Nothing to do since the option went on: the devices agree by themselves.
  const agreed =
    !pushedAnything && results.size === 0 && pushes.length === 0 && planner.bouncing === null
  if (!agreed && target !== null) {
    const wanted = { orderIds: target.orderIds, activeId: target.activeId, changedAt: null }
    const following = members
      .filter((m) => m.key !== target.source && sameSyncState(syncStateOf(m.report), wanted))
      .map((m) => m.name)
    const from = name(target.source)
    if (following.length > 0) {
      const followers = following.join(', ')
      const changed = relativeAge(target.at, new Date(now * 1000))
      const text =
        following.length === 1
          ? target.at > 0
            ? translateMain(
                'grazr.sync.followsChanged',
                '{{followers}} follows {{from}} (changed {{changed}})',
                { followers, from, changed }
              )
            : translateMain('grazr.sync.follows', '{{followers}} follows {{from}}', {
                followers,
                from
              })
          : target.at > 0
            ? translateMain(
                'grazr.sync.followChanged',
                '{{followers}} follow {{from}} (changed {{changed}})',
                { followers, from, changed }
              )
            : translateMain('grazr.sync.follow', '{{followers}} follow {{from}}', {
                followers,
                from
              })
      lines.push(line('in-sync', text, 'ok'))
    }
    for (const push of pushes) {
      if (push.switchTo === null && push.orderNames === null) {
        continue
      }
      const who = name(push.device)
      const text =
        push.switchTo !== null
          ? translateMain(
              'grazr.sync.willMove',
              "{{who}} will move to {{account}} and take {{from}}'s order",
              { who, account: account(push.switchTo, push.device), from }
            )
          : translateMain('grazr.sync.willTakeOrder', "{{who}} will take {{from}}'s order", {
              who,
              from
            })
      lines.push(line(`push-${push.device}`, text, 'ok', push.device))
    }
  } else {
    lines.push(line('in-sync', translateMain('grazr.sync.allInSync', 'All devices in sync'), 'ok'))
  }

  for (const member of members) {
    const problem = results.get(member.key)
    if (problem === undefined) {
      continue
    }
    const who = member.name
    let blocked: string | null = null
    let text: string
    switch (problem.kind) {
      case 'blocked':
        blocked = member.report.accounts.find((a) => a.id === problem.accountId)?.name ?? null
        text = translateMain(
          'grazr.sync.blocked',
          '{{who}}: {{account}} is blocked ({{reason}}), still on {{active}}',
          {
            who,
            account: account(problem.accountId, member.key),
            reason: problem.reason,
            active: account(member.report.active?.id ?? null, member.key)
          }
        )
        break
      case 'not-enrolled':
        text = translateMain('grazr.sync.notEnrolled', '{{who}}: {{account}} is not enrolled', {
          who,
          account: account(problem.accountId, member.key)
        })
        break
      case 'needs-update':
        text = translateMain(
          'grazr.sync.needsUpdate',
          'grazr on {{who}} needs {{version}} or later',
          {
            who,
            version: SET_ACCOUNTS_SINCE
          }
        )
        break
      case 'refused':
        text = translateMain('grazr.sync.refused', '{{who}}: {{words}}', {
          who,
          words: problem.text
        })
        break
    }
    lines.push(line(`problem-${member.key}`, text, 'warning', member.key, blocked))
  }
  return lines
}
