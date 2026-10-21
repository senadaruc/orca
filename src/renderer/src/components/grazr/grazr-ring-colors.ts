import type {
  GrazrCentreTone,
  GrazrRowStatus,
  GrazrSegmentState
} from '../../../../shared/grazr-rotation-view'

// Why: the tokens come from main.css and the usage chip's palette, so both themes read the same way.
export const ACCOUNT_OK_CLASS = 'text-status-success'
export const ACCOUNT_NEXT_CLASS = 'text-agent-question'
export const ACCOUNT_SPENT_CLASS = 'text-destructive'
export const ACCOUNT_MUTED_CLASS = 'text-muted-foreground'

export const SEGMENT_CLASS: Record<GrazrSegmentState, string> = {
  active: ACCOUNT_OK_CLASS,
  ok: `${ACCOUNT_OK_CLASS}/40`,
  next: ACCOUNT_NEXT_CLASS,
  spent: `${ACCOUNT_SPENT_CLASS}/60`,
  blocked: ACCOUNT_SPENT_CLASS,
  unknown: 'text-muted-foreground/20'
}

export const RING_FILL_CLASS = ACCOUNT_OK_CLASS

export const CENTRE_TONE_CLASS: Record<GrazrCentreTone, string> = {
  fine: ACCOUNT_OK_CLASS,
  warning: 'text-status-warning',
  spent: ACCOUNT_SPENT_CLASS,
  blocked: ACCOUNT_SPENT_CLASS,
  none: 'text-foreground'
}

export const ROW_LABEL_CLASS: Record<GrazrRowStatus, string> = {
  active: ACCOUNT_OK_CLASS,
  next: ACCOUNT_NEXT_CLASS,
  spent: ACCOUNT_MUTED_CLASS,
  blocked: ACCOUNT_SPENT_CLASS,
  'not-enrolled': ACCOUNT_MUTED_CLASS,
  unread: ACCOUNT_MUTED_CLASS,
  ok: ACCOUNT_MUTED_CLASS
}

export const ROW_DOT_CLASS: Record<GrazrRowStatus, string> = {
  active: 'bg-status-success',
  next: 'bg-agent-question',
  spent: 'bg-muted-foreground/20',
  blocked: 'bg-destructive',
  'not-enrolled': 'bg-muted-foreground/20',
  unread: 'bg-muted-foreground/20',
  ok: 'bg-status-success/40'
}
