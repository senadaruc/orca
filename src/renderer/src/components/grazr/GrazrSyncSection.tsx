import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { grazrHostKey, type GrazrHostRef } from '../../../../shared/grazr-host'
import type { GrazrSyncLine } from '../../../../shared/grazr-sync-types'
import { useGrazrSync } from './use-grazr-sync'

// The dialog's sync switch and what the sync is doing: the first-enable preview with Apply, or one
// line per device afterwards. HerdrM's GrazrSyncSection.
export function GrazrSyncSection({
  host,
  onReauthenticate
}: {
  host: GrazrHostRef
  // Re-login for a blocked account on the dialog's own host; other hosts only show the line.
  onReauthenticate: (() => void) | null
}): React.JSX.Element {
  const { sync, setEnabled, apply, setIncluded } = useGrazrSync()
  const hostKey = grazrHostKey(host)
  const members = sync.devices.filter((device) => device.runsGrazr)

  function lineView(line: GrazrSyncLine): React.JSX.Element {
    const ownHost =
      line.deviceKey !== null &&
      sync.devices.some((d) => d.key === line.deviceKey && grazrHostKey(d.host) === hostKey)
    return (
      <div key={line.id} className="flex items-baseline gap-2">
        <span
          className={cn(
            'min-w-0 flex-1 text-xs',
            line.tone === 'warning' ? 'text-status-warning' : 'text-muted-foreground'
          )}
        >
          {line.text}
        </span>
        {line.blockedAccount !== null && ownHost && onReauthenticate !== null && (
          <Button type="button" size="sm" variant="outline" onClick={onReauthenticate}>
            {translate('grazr.dialog.sync.reauthenticate', 'Re-authenticate…')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="flex min-w-0 items-start gap-2.5 text-sm">
        <Checkbox
          checked={sync.enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
          className="mt-0.5"
        />
        <span className="min-w-0 space-y-0.5">
          <span className="block">
            {translate('grazr.dialog.sync.title', 'Keep accounts in sync across devices')}
          </span>
          <span className="block text-xs text-muted-foreground">
            {translate(
              'grazr.dialog.sync.hint',
              'Last change wins. Pins and thresholds stay per device.'
            )}
          </span>
        </span>
      </label>
      {sync.status.kind !== 'off' && (
        <div className="space-y-1.5 pl-6">
          {members.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                {translate('grazr.dialog.sync.devices', 'Devices in the sync')}
              </span>
              {members.map((device) => (
                <label key={device.key} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={device.included}
                    onCheckedChange={(checked) => setIncluded(device.key, checked === true)}
                  />
                  <span>{device.name}</span>
                </label>
              ))}
            </div>
          )}
          {sync.status.kind === 'few-devices' && sync.status.name !== null && (
            <p className="text-xs text-muted-foreground">
              {translate(
                'grazr.dialog.sync.onlyOne',
                'Only {{name}} is in the sync, nothing to sync yet',
                { name: sync.status.name }
              )}
            </p>
          )}
          {(sync.status.kind === 'preview' || sync.status.kind === 'lines') &&
            sync.status.lines.map(lineView)}
          {sync.status.kind === 'preview' && (
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={apply}>
                {translate('grazr.dialog.sync.apply', 'Apply')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
