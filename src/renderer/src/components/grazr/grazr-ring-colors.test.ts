import { describe, expect, it } from 'vitest'
import { CENTRE_TONE_CLASS, ROW_LABEL_CLASS, SEGMENT_CLASS } from './grazr-ring-colors'

const COMPLETE_CLASS = /^(text|bg)-[a-z-]+(\/\d+)?$/

describe('grazr ring colours', () => {
  it('colours spent and blocked segments red and leaves unknown segments muted', () => {
    expect(SEGMENT_CLASS.spent).toBe('text-destructive/60')
    expect(SEGMENT_CLASS.blocked).toBe('text-destructive')
    expect(SEGMENT_CLASS.unknown).toBe('text-muted-foreground/20')
  })

  it('brightens the active segment above the other healthy ones', () => {
    expect(SEGMENT_CLASS.active).toBe('text-status-success')
    expect(SEGMENT_CLASS.ok).toBe('text-status-success/40')
    expect(SEGMENT_CLASS.next).toBe('text-agent-question')
  })

  it('writes every class out in full so the bundler emits it', () => {
    for (const value of [
      ...Object.values(SEGMENT_CLASS),
      ...Object.values(CENTRE_TONE_CLASS),
      ...Object.values(ROW_LABEL_CLASS)
    ]) {
      expect(value).toMatch(COMPLETE_CLASS)
    }
  })

  it('maps the centre tone to the warning colour below the threshold and red when spent', () => {
    expect(CENTRE_TONE_CLASS.warning).toBe('text-status-warning')
    expect(CENTRE_TONE_CLASS.spent).toBe('text-destructive')
  })
})
