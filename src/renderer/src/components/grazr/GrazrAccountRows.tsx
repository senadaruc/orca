import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GrazrRotationRow } from '../../../../shared/grazr-rotation-view'
import type { GrazrLimitResetKind } from './grazr-limit-reset-command'
import { ACCOUNT_OK_CLASS, ROW_DOT_CLASS, ROW_LABEL_CLASS } from './grazr-ring-colors'
import { GrazrWindowBars } from './GrazrWindowBars'

export function GrazrAccountRows({
  rows,
  parkedNames,
  actionsDisabled,
  terminalAvailable,
  onSwap,
  onReauthenticate,
  onUseReset
}: {
  rows: GrazrRotationRow[]
  parkedNames: ReadonlySet<string>
  actionsDisabled: boolean
  terminalAvailable: boolean
  onSwap: (name: string) => void
  onReauthenticate: (name: string) => void
  // swapTo names a parked account to swap to first; null means the active account.
  onUseReset: (kind: GrazrLimitResetKind, swapTo: string | null) => void
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((row) => {
        const canSwap = parkedNames.has(row.name) && !row.isActive && row.blocked === null
        return (
          <li key={row.name} className="space-y-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {row.index}
              </span>
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', ROW_DOT_CLASS[row.status])}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('truncate', row.isActive && ACCOUNT_OK_CLASS)}>
                    {row.name}
                  </span>
                  {row.plan && <Badge variant="outline">{row.plan}</Badge>}
                  {row.unusedReset === true && (
                    <Badge variant="secondary">
                      {translate('grazr.dialog.resetAvailable', 'Reset available')}
                    </Badge>
                  )}
                </div>
                {row.email && (
                  <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                )}
                {row.organization && row.organization !== `${row.name}'s Organization` && (
                  <div className="truncate text-xs text-muted-foreground">{row.organization}</div>
                )}
              </div>
              <span className="shrink-0 tabular-nums">
                {row.percent === null ? '—' : `${row.percent}%`}
              </span>
              {row.label && (
                <span
                  className={cn(
                    'max-w-[10rem] shrink truncate text-xs',
                    ROW_LABEL_CLASS[row.status]
                  )}
                >
                  {row.label}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('grazr.dialog.accountActions', 'Account actions')}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canSwap || actionsDisabled}
                    onSelect={() => onSwap(row.name)}
                  >
                    {translate('grazr.dialog.swapToThis', 'Swap to this account')}
                  </DropdownMenuItem>
                  {row.blocked !== null && (
                    <DropdownMenuItem
                      disabled={!terminalAvailable || actionsDisabled}
                      onSelect={() => onReauthenticate(row.name)}
                    >
                      {translate('grazr.dialog.reauthenticate', 'Re-authenticate…')}
                    </DropdownMenuItem>
                  )}
                  {/* Why: Claude Code uses a reset for the login it runs on. */}
                  {row.isActive && row.unusedReset === true && (
                    <>
                      <DropdownMenuItem
                        disabled={!terminalAvailable || actionsDisabled}
                        onSelect={() => onUseReset('fable', null)}
                      >
                        {translate('grazr.dialog.useModelReset', 'Use model reset…')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!terminalAvailable || actionsDisabled}
                        onSelect={() => onUseReset('full', null)}
                      >
                        {translate('grazr.dialog.useFullReset', 'Use full reset…')}
                      </DropdownMenuItem>
                    </>
                  )}
                  {canSwap && row.unusedReset === true && (
                    <>
                      <DropdownMenuItem
                        disabled={!terminalAvailable || actionsDisabled}
                        onSelect={() => onUseReset('fable', row.name)}
                      >
                        {translate('grazr.dialog.swapUseModelReset', 'Swap and use model reset…')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!terminalAvailable || actionsDisabled}
                        onSelect={() => onUseReset('full', row.name)}
                      >
                        {translate('grazr.dialog.swapUseFullReset', 'Swap and use full reset…')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {row.windows.length > 0 && (
              <div className="pl-8">
                <GrazrWindowBars windows={row.windows} />
              </div>
            )}
            {row.readingFrom && (
              <div className="pl-8 text-xs text-muted-foreground">
                {translate('grazr.dialog.readingFrom', 'Reading from {{when}}', {
                  when: row.readingFrom
                })}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
