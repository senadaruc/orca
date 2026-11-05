import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

// The host's rotation toggle and, below it, the per-device model switch, as HerdrM's sheet lays them out.
export function GrazrRotationControls({
  rotating,
  busy,
  onRotatingChange
}: {
  rotating: boolean
  busy: boolean
  onRotatingChange: (checked: boolean) => void
}): React.JSX.Element {
  const autoModelSwitch = useAppStore((s) => s.settings?.grazrAutoModelSwitch === true)
  const updateSettings = useAppStore((s) => s.updateSettings)
  return (
    <>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{translate('grazr.dialog.rotateAutomatically', 'Rotate automatically')}</span>
        <Switch checked={rotating} disabled={busy} onCheckedChange={onRotatingChange} />
      </label>
      <label className="flex min-w-0 items-start gap-2.5 text-sm">
        <Checkbox
          checked={autoModelSwitch}
          onCheckedChange={(checked) =>
            void updateSettings({ grazrAutoModelSwitch: checked === true })
          }
          className="mt-0.5"
        />
        <span className="min-w-0 space-y-0.5">
          <span className="block">
            {translate(
              'grazr.dialog.autoModelSwitch',
              'When Fable runs out, switch model and continue'
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {translate(
              'grazr.dialog.autoModelSwitchHint',
              'Agents keep working on the fallback model. Never spends credits.'
            )}
          </span>
        </span>
      </label>
    </>
  )
}
