import { Repeat } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { GrazrHostOutcome } from '../../../../shared/grazr-api-types'
import {
  grazrActiveEmail,
  grazrConnectionAction,
  grazrSwitchTargets,
  useGrazrWorktreeMenu,
  type GrazrSwitchTarget
} from './use-grazr-worktree-menu'

export function GrazrWorktreeMenuItems(props: { worktreeId: string; disabled: boolean }) {
  const menu = useGrazrWorktreeMenu(props.worktreeId)
  if (menu.host === null) {
    return null
  }
  const outcome = menu.status?.outcome ?? null
  const ok = outcome?.kind === 'ok' ? outcome : null
  const connection = ok ? grazrConnectionAction(ok.report.installed) : null
  // Why: the rows are read as of the fetch, so a render never depends on the wall clock.
  const activeEmail = ok ? grazrActiveEmail(ok.report, new Date(ok.fetchedAt)) : null
  const targets = ok ? grazrSwitchTargets(ok.report, new Date(ok.fetchedAt)) : []

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          disabled={props.disabled}
          onPointerEnter={menu.load}
          onFocus={menu.load}
        >
          <Repeat className="size-3.5" />
          {translate('grazr.menu.grazr', 'grazr')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          <DropdownMenuItem onSelect={menu.actions.openAccounts} disabled={props.disabled}>
            {translate('grazr.menu.accounts', 'Accounts…')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={props.disabled}>
              {translate('grazr.menu.switchShared', 'Switch Shared Account')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {renderTargets({
                outcomeKind: outcome?.kind ?? null,
                targets,
                disabled: props.disabled,
                onSwapTo: menu.actions.swapTo
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {activeEmail !== null ? (
            <DropdownMenuItem onSelect={menu.actions.reauthenticate} disabled={props.disabled}>
              {translate('grazr.menu.reauthenticate', 'Re-authenticate {{email}}…', {
                email: activeEmail
              })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {connection === 'connect' ? (
            <DropdownMenuItem onSelect={menu.actions.connect} disabled={props.disabled}>
              {translate('grazr.menu.connect', "Connect to Claude's status line")}
            </DropdownMenuItem>
          ) : null}
          {connection === 'disconnect' ? (
            <DropdownMenuItem onSelect={menu.actions.disconnect} disabled={props.disabled}>
              {translate('grazr.menu.disconnect', "Disconnect from Claude's status line")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={menu.actions.swapNext} disabled={props.disabled}>
            {translate('grazr.menu.swapNext', 'Swap to the next account now')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  )
}

function renderTargets(args: {
  outcomeKind: GrazrHostOutcome['kind'] | null
  targets: GrazrSwitchTarget[]
  disabled: boolean
  onSwapTo: (name: string) => void
}) {
  const { outcomeKind, targets, disabled, onSwapTo } = args
  if (outcomeKind === null) {
    return (
      <DropdownMenuItem disabled>{translate('grazr.menu.loading', 'Loading…')}</DropdownMenuItem>
    )
  }
  if (outcomeKind !== 'ok') {
    return (
      <DropdownMenuItem disabled>
        {translate('grazr.menu.unavailable', 'Not available for this host')}
      </DropdownMenuItem>
    )
  }
  if (targets.length === 0) {
    return (
      <DropdownMenuItem disabled>
        {translate('grazr.menu.noOtherAccounts', 'No other accounts')}
      </DropdownMenuItem>
    )
  }
  return targets.map((target) => (
    <DropdownMenuItem key={target.name} onSelect={() => onSwapTo(target.name)} disabled={disabled}>
      {target.isNext
        ? translate('grazr.menu.nextAccount', '{{name}} · NEXT ▸', { name: target.name })
        : target.name}
    </DropdownMenuItem>
  ))
}
