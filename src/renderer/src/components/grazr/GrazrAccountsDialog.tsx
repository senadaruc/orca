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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSegmentedControl } from '@/components/settings/form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  buildGrazrRotationView,
  nextAccount,
  type GrazrWindowView
} from '../../../../shared/grazr-rotation-view'
import type { GrazrHostOutcome } from '../../../../shared/grazr-api-types'
import { grazrHostChip } from '../../../../shared/grazr-host-chip'
import { GrazrHostRefSchema, grazrHostKey, type GrazrHostRef } from '../../../../shared/grazr-host'
import { GrazrAccountRows } from './GrazrAccountRows'
import { GrazrClockRing } from './GrazrClockRing'
import { grazrChipCopy } from './grazr-chip-copy'
import { openGrazrEnrolTerminal } from './grazr-enrol-terminal'
import { GrazrOutcomeBody } from './GrazrOutcomeBody'
import { GrazrRotationControls } from './GrazrRotationControls'
import { GrazrSyncSection } from './GrazrSyncSection'
import { useGrazrHostStatus } from './use-grazr-host-status'

const POLL_MS = 60_000

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
  // Why: the dialog mounts beside providerless siblings in App, so it brings its own tooltip provider.
  return (
    <TooltipProvider delayDuration={400}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose()
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <GrazrAccountsBody
            key={grazrHostKey(target.host)}
            host={target.host}
            label={target.label}
            worktreeId={target.worktreeId}
            onClose={onClose}
          />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
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
  const { status, loading, busy, spinning, run, refresh, asOf } = useGrazrHostStatus(host, {
    pollMs: POLL_MS,
    label
  })
  const [windowView, setWindowView] = useState<GrazrWindowView>('session')
  // Why: only a refusal naming a foreign owner switches Connect to a takeover, and the refusal's message is shown inline.
  const [foreignRefusal, setForeignRefusal] = useState<string | null>(null)
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
  const engineOutdated = status?.engineOutdated === true
  // Why: outside the ok state a refresh only re-reads the status; the engine refresh verb would read every account.
  function refreshAccounts(): void {
    if (report) {
      void run(() => window.api.grazr.refresh(host))
      return
    }
    void refresh()
  }

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
        label: translate('grazr.dialog.loginTabLabel', 'Claude Accounts')
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
    const takeOver = foreignRefusal !== null
    const result = await run(() => window.api.grazr.install(host, takeOver))
    if (result?.ok) {
      setForeignRefusal(null)
    } else if (result && result.foreignOwner) {
      setForeignRefusal(result.message)
    }
  }

  const connectLabel =
    foreignRefusal !== null
      ? translate('grazr.dialog.takeOver', 'Take over the status line')
      : translate('grazr.dialog.connect', "Connect to Claude's status line")

  const subtitleBase =
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
  // Why: the time only means something once a status has been read, so it stays out of the header before that.
  const asOfText =
    report !== null && asOf !== null
      ? translate('grazr.dialog.asOf', 'as of {{time}}', {
          time: new Date(asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })
      : null
  const subtitle = asOfText ? `${subtitleBase} · ${asOfText}` : subtitleBase

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-10">
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
                {report.installed !== true ? (
                  <DropdownMenuItem disabled={busy} onSelect={() => void connect()}>
                    {connectLabel}
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
          {engineOutdated && (
            <div className="flex justify-center">
              <Badge variant="outline">
                {translate(
                  'grazr.dialog.engineOutdated',
                  'Engine {{installed}} · update to {{bundled}} available',
                  {
                    installed: report.version ?? '',
                    bundled: status?.bundledEngineVersion ?? ''
                  }
                )}
              </Badge>
            </div>
          )}
          {report.installed !== true && (
            <div className="space-y-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void connect()}>
                {connectLabel}
              </Button>
              {foreignRefusal !== null && (
                <p className="text-sm text-destructive">{foreignRefusal}</p>
              )}
            </div>
          )}
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
          <GrazrClockRing
            segments={view.segments}
            centre={view.centre}
            modelScopes={view.modelScopes}
          />
          <GrazrAccountRows
            rows={view.rows}
            parkedNames={new Set(report.accounts.filter((a) => a.parked).map((a) => a.name))}
            actionsDisabled={busy}
            terminalAvailable={terminalAvailable}
            onSwap={(name) => void run(() => window.api.grazr.swap(host, name))}
            onReauthenticate={() => void startLogin()}
          />
          <GrazrRotationControls
            rotating={report.settings.enabled}
            busy={busy}
            onRotatingChange={(checked) =>
              void run(() => window.api.grazr.setEnabled(host, checked))
            }
          />
          <GrazrSyncSection
            host={host}
            onReauthenticate={terminalAvailable ? () => void startLogin() : null}
          />
        </div>
      ) : (
        <GrazrOutcomeBody
          outcome={outcome}
          loading={loading}
          busy={busy}
          onDeploy={() => void run(() => window.api.grazr.deploy(host))}
          onRetry={() => void refresh()}
        />
      )}

      <DialogFooter className="flex-col items-stretch sm:flex-col sm:justify-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {spinning && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={refreshAccounts}
            >
              {translate('grazr.dialog.refresh', 'Refresh')}
            </Button>
            {report && (
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
            )}
            {engineOutdated && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => window.api.grazr.deploy(host))}
              >
                {translate('grazr.dialog.updateEngine', 'Update engine…')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <Button
                type="button"
                size="sm"
                disabled={busy || next === null}
                onClick={() => void run(() => window.api.grazr.swap(host))}
              >
                {translate('grazr.dialog.swapNext', 'Swap to Next Account')}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {translate('grazr.dialog.done', 'Done')}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </>
  )
}
