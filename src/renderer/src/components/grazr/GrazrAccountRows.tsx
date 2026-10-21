import { MoreHorizontal } from 'lucide-react'
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
import { ACCOUNT_OK_CLASS, ROW_DOT_CLASS, ROW_LABEL_CLASS } from './grazr-ring-colors'

export function GrazrAccountRows({
  rows,
  parkedNames,
  actionsDisabled,
  terminalAvailable,
  onSwap,
  onReauthenticate
}: {
  rows: GrazrRotationRow[]
  parkedNames: ReadonlySet<string>
  actionsDisabled: boolean
  terminalAvailable: boolean
  onSwap: (name: string) => void
  onReauthenticate: (name: string) => void
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((row) => {
        const canSwap = parkedNames.has(row.name) && !row.isActive && row.blocked === null
        return (
          <li key={row.name} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {row.index}
            </span>
            <span
              aria-hidden="true"
              className={cn('size-2 shrink-0 rounded-full', ROW_DOT_CLASS[row.status])}
            />
            <div className="min-w-0 flex-1">
              <div className={cn('truncate', row.isActive && ACCOUNT_OK_CLASS)}>{row.name}</div>
              {row.email && (
                <div className="truncate text-xs text-muted-foreground">{row.email}</div>
              )}
            </div>
            <span className="shrink-0 tabular-nums">
              {row.percent === null ? '—' : `${row.percent}%`}
            </span>
            {row.label && (
              <span
                className={cn('max-w-[10rem] shrink truncate text-xs', ROW_LABEL_CLASS[row.status])}
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
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )
      })}
    </ul>
  )
}
