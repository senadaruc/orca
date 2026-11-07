import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { GrazrHostOutcome } from '../../../../shared/grazr-api-types'

export function GrazrOutcomeBody({
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
