import type {
  GrazrCentreTone,
  GrazrRowStatus,
  GrazrSegmentState,
  GrazrWindowTone
} from '../../../../shared/grazr-rotation-view'

// Why: the tokens come from main.css and the usage chip's palette, so both themes read the same way.
export const ACCOUNT_OK_CLASS = 'text-status-success'
export const ACCOUNT_NEXT_CLASS = 'text-agent-question'
export const ACCOUNT_SPENT_CLASS = 'text-destructive'
export const ACCOUNT_MUTED_CLASS = 'text-muted-foreground'

// Why: Tailwind only emits classes written out in full, so each opacity variant is a literal string.
export const SEGMENT_CLASS: Record<GrazrSegmentState, string> = {
  active: 'text-status-success',
  ok: 'text-status-success/40',
  next: 'text-agent-question',
  spent: 'text-destructive/60',
  blocked: 'text-destructive',
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

// The inner model rings: a muted track under a fill in the segment's own colour.
export const MODEL_RING_TRACK_CLASS = 'text-muted-foreground/20'

export const WINDOW_TEXT_CLASS: Record<GrazrWindowTone, string> = {
  fine: ACCOUNT_OK_CLASS,
  warning: 'text-status-warning',
  spent: ACCOUNT_SPENT_CLASS
}

// Why: the Progress primitive paints its indicator with bg-primary, so the tone is set through its slot.
export const WINDOW_FILL_CLASS: Record<GrazrWindowTone, string> = {
  fine: '[&_[data-slot=progress-indicator]]:bg-status-success',
  warning: '[&_[data-slot=progress-indicator]]:bg-status-warning',
  spent: '[&_[data-slot=progress-indicator]]:bg-destructive'
}
