import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  buildGrazrRotationView,
  grazrHostChip,
  nextAccount,
  type GrazrWindowView
} from '../../../../shared/grazr-rotation-view'
import type { GrazrHostOutcome } from '../../../../shared/grazr-api-types'
import { GrazrHostRefSchema, grazrHostKey, type GrazrHostRef } from '../../../../shared/grazr-host'
import { GrazrAccountRows } from './GrazrAccountRows'
import { GrazrClockRing } from './GrazrClockRing'
import { grazrChipCopy } from './grazr-chip-copy'
import { openGrazrEnrolTerminal } from './grazr-enrol-terminal'
import { useGrazrHostStatus } from './use-grazr-host-status'

const POLL_MS = 60_000
const LOGIN_TAB_LABEL = 'Claude Accounts'

type Target = { host: GrazrHostRef; label: string; worktreeId: string | null }

function parseTarget(data: Record<string, unknown>): Target | null {
  const host = GrazrHostRefSchema.safeParse(data.host)
  if (!host.success) {
    return null
  }
  return {
    host: host.data,
    label: typeof data.label === 'string' ? data.label : '',
    worktreeId: typeof data.worktreeId === 'string' ? data.worktreeId : null
  }
}

export function GrazrAccountsDialog(): React.JSX.Element | null {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  if (activeModal !== 'grazr-accounts') {
    return null
  }
  return <GrazrAccountsModal modalData={modalData} onClose={closeModal} />
}

function GrazrAccountsModal({
  modalData,
  onClose
}: {
  modalData: Record<string, unknown>
  onClose: () => void
}): React.JSX.Element | null {
  // Why: the host must keep its identity across renders, or the status hook would re-read on every render.
  const target = useMemo(() => parseTarget(modalData), [modalData])
  if (target === null) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <GrazrAccountsBody
          key={grazrHostKey(target.host)}
          host={target.host}
          label={target.label}
          worktreeId={target.worktreeId}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

function GrazrAccountsBody({
  host,
  label,
  worktreeId,
  onClose
}: {
  host: GrazrHostRef
  label: string
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { status, loading, busy, spinning, run, asOf } = useGrazrHostStatus(host, {
    pollMs: POLL_MS
  })
  const [windowView, setWindowView] = useState<GrazrWindowView>('session')
  // Why: a refused install names the foreign owner, so the next Connect must take the line over.
  const [takeOver, setTakeOver] = useState(false)
  const now = useMemo(() => new Date(asOf ?? 0), [asOf])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const outcome: GrazrHostOutcome | null = status?.outcome ?? null
  const report = outcome?.kind === 'ok' ? outcome.report : null
  const view = useMemo(
    () => (report ? buildGrazrRotationView(report, windowView, now, timeZone) : null),
    [report, windowView, now, timeZone]
  )
  const next = report ? nextAccount(report, now) : null
  const chip = outcome ? grazrHostChip(outcome) : null
  const terminalAvailable = worktreeId !== null

  async function startLogin(): Promise<void> {
    if (worktreeId === null) {
      return
    }
    const result = await run(async () => {
      const enrol = await window.api.grazr.enrolCommand(host)
      if ('error' in enrol) {
        return { ok: false, message: enrol.error }
      }
      const opened = openGrazrEnrolTerminal({
        worktreeId,
        command: enrol.command,
        label: LOGIN_TAB_LABEL
      })
      return opened
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: translate(
              'grazr.dialog.terminalFailed',
              'Could not open a terminal for the login.'
            )
          }
    })
    if (result?.ok) {
      toast.message(
        translate(
          'grazr.dialog.finishLogin',
          'Finish the login in the terminal, then reopen Claude Accounts'
        )
      )
      onClose()
    }
  }

  async function connect(): Promise<void> {
    const result = await run(() => window.api.grazr.install(host, takeOver))
    if (result && !result.ok && result.foreignOwner) {
      setTakeOver(true)
    }
  }

  const subtitle =
    report !== null
      ? translate(
          'grazr.dialog.subtitle',
          '{{label}} · swaps below {{session}}% 5h · {{weekly}}% week',
          {
            label,
            session: report.settings.thresholds.session,
            weekly: report.settings.thresholds.weekly
          }
        )
      : label

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DialogTitle>{translate('grazr.dialog.title', 'Claude Accounts')}</DialogTitle>
          {report && chip ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Badge variant={grazrChipCopy(chip.kind).tone} asChild>
                  <button type="button" disabled={busy}>
                    {grazrChipCopy(chip.kind).label}
                  </button>
                </Badge>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {report.installed === false ? (
                  <DropdownMenuItem disabled={busy} onSelect={() => void connect()}>
                    {takeOver || chip.kind === 'foreign'
                      ? translate('grazr.dialog.takeOver', 'Take over the status line')
                      : translate('grazr.dialog.connect', "Connect to Claude's status line")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => void run(() => window.api.grazr.uninstall(host))}
                  >
                    {translate('grazr.dialog.disconnect', "Disconnect from Claude's status line")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            chip && (
              <Badge variant={grazrChipCopy(chip.kind).tone}>
                {grazrChipCopy(chip.kind).label}
              </Badge>
            )
          )}
        </div>
        <DialogDescription>{subtitle}</DialogDescription>
      </DialogHeader>

      {report && view ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <SettingsSegmentedControl<GrazrWindowView>
              ariaLabel={translate('grazr.dialog.windowLabel', 'Usage window')}
              value={windowView}
              onChange={setWindowView}
              options={[
                { value: 'weekly', label: translate('grazr.dialog.window.weekly', 'Week') },
                { value: 'session', label: translate('grazr.dialog.window.session', '5h') }
              ]}
            />
          </div>
          <GrazrClockRing segments={view.segments} centre={view.centre} />
          <GrazrAccountRows
            rows={view.rows}
            parkedNames={new Set(report.accounts.filter((a) => a.parked).map((a) => a.name))}
            actionsDisabled={busy}
            terminalAvailable={terminalAvailable}
            onSwap={(name) => void run(() => window.api.grazr.swap(host, name))}
            onReauthenticate={() => void startLogin()}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{translate('grazr.dialog.rotateAutomatically', 'Rotate automatically')}</span>
            <Switch
              checked={report.settings.enabled}
              disabled={busy}
              onCheckedChange={(checked) =>
                void run(() => window.api.grazr.setEnabled(host, checked))
              }
            />
          </label>
        </div>
      ) : (
        <OutcomeBody
          outcome={outcome}
          loading={loading}
          busy={busy}
          onDeploy={() => void run(() => window.api.grazr.deploy(host))}
          onRetry={() => void run(() => window.api.grazr.refresh(host))}
        />
      )}

      <DialogFooter className="sm:justify-between">
        <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
          {asOf !== null &&
            translate('grazr.dialog.asOf', 'as of {{time}}', {
              time: new Date(asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            })}
          {spinning && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => window.api.grazr.refresh(host))}
          >
            {translate('grazr.dialog.refresh', 'Refresh')}
          </Button>
          {report && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !terminalAvailable}
                      onClick={() => void startLogin()}
                    >
                      {translate('grazr.dialog.addAccount', 'Add Account…')}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!terminalAvailable && (
                  <TooltipContent>
                    {translate(
                      'grazr.dialog.openWorkspaceFirst',
                      'Open a workspace on this server first'
                    )}
                  </TooltipContent>
                )}
              </Tooltip>
              <Button
                type="button"
                size="sm"
                disabled={busy || next === null}
                onClick={() => void run(() => window.api.grazr.swap(host))}
              >
                {translate('grazr.dialog.swapNext', 'Swap to Next Account')}
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {translate('grazr.dialog.done', 'Done')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

function OutcomeBody({
  outcome,
  loading,
  busy,
  onDeploy,
  onRetry
}: {
  outcome: GrazrHostOutcome | null
  loading: boolean
  busy: boolean
  onDeploy: () => void
  onRetry: () => void
}): React.JSX.Element | null {
  if (outcome === null || loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {translate('grazr.dialog.loading', 'Reading the status…')}
      </p>
    )
  }
  switch (outcome.kind) {
    case 'ok':
      return null
    case 'not-deployed':
      return (
        <div className="space-y-3 text-sm">
          <p>
            {translate(
              'grazr.dialog.notDeployed',
              'The Claude Accounts engine is not on this host yet. Deploy it to start rotating accounts.'
            )}
          </p>
          <Button type="button" size="sm" disabled={busy} onClick={onDeploy}>
            {translate('grazr.dialog.deployEngine', 'Deploy engine')}
          </Button>
        </div>
      )
    case 'no-ssh-access':
      return (
        <p className="text-sm text-muted-foreground">
          {translate('grazr.dialog.noSshAccess', 'Connect this host over SSH first.')}
        </p>
      )
    case 'unsupported-platform':
      return (
        <p className="text-sm text-muted-foreground">
          {translate(
            'grazr.dialog.unsupportedPlatform',
            'Claude Accounts is not available on this platform.'
          )}
        </p>
      )
    case 'engine-error':
    case 'unreachable':
      return (
        <div className="space-y-3 text-sm">
          <p className="text-destructive">{outcome.message}</p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>
            {translate('grazr.dialog.retry', 'Retry')}
          </Button>
        </div>
      )
  }
}
