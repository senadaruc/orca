import { translate } from '@/i18n/i18n'
import type { GrazrHostChipKind } from '../../../../shared/grazr-host-chip'

export type GrazrChipTone = 'default' | 'secondary' | 'outline'

// Why: the state badge is the one place a host's rotation state reads at a glance, so its tone follows that state.
const TONE: Record<GrazrHostChipKind, GrazrChipTone> = {
  on: 'default',
  off: 'secondary',
  'not-connected': 'secondary',
  foreign: 'outline',
  managed: 'outline',
  'not-deployed': 'outline',
  unreachable: 'outline',
  'no-ssh-access': 'outline',
  'unsupported-platform': 'outline',
  'engine-error': 'outline'
}

// Why: each key is written out so the localization extractor can see it.
function chipLabel(kind: GrazrHostChipKind): string {
  switch (kind) {
    case 'on':
      return translate('grazr.dialog.chip.on', 'rotation on')
    case 'off':
      return translate('grazr.dialog.chip.off', 'rotation off')
    case 'not-connected':
      return translate('grazr.dialog.chip.notConnected', 'not connected')
    case 'foreign':
      return translate('grazr.dialog.chip.foreign', 'another grazr owns the status line')
    case 'managed':
      return translate('grazr.dialog.chip.managed', 'managed profile')
    case 'not-deployed':
      return translate('grazr.dialog.chip.notDeployed', 'engine not deployed')
    case 'unreachable':
      return translate('grazr.dialog.chip.unreachable', 'unreachable')
    case 'no-ssh-access':
      return translate('grazr.dialog.chip.noSshAccess', 'no SSH access')
    case 'unsupported-platform':
      return translate('grazr.dialog.chip.unsupportedPlatform', 'unsupported platform')
    case 'engine-error':
      return translate('grazr.dialog.chip.engineError', 'engine error')
  }
}

export function grazrChipCopy(kind: GrazrHostChipKind): { label: string; tone: GrazrChipTone } {
  return { label: chipLabel(kind), tone: TONE[kind] }
}
