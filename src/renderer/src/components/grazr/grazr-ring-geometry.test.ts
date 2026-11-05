import { describe, expect, it } from 'vitest'
import type { GrazrRingSegment } from '../../../../shared/grazr-rotation-view'
import { arcPath, ringSegments } from './grazr-ring-geometry'

function segment(overrides: Partial<GrazrRingSegment> & { index: number }): GrazrRingSegment {
  return { name: `acct${overrides.index}`, remaining: 50, models: {}, state: 'ok', ...overrides }
}

describe('arcPath', () => {
  it('draws a quarter arc clockwise from twelve o clock to three', () => {
    expect(arcPath(110, 110, 80, 0, 90)).toBe('M 110 30 A 80 80 0 0 1 190 110')
  })

  it('clamps a full-circle request so the arc is never degenerate', () => {
    const d = arcPath(110, 110, 80, 0, 360)
    expect(d).toMatch(/^M 110 30 A 80 80 0 1 1 /)
    expect(d).not.toMatch(/ 110 30$/)
  })
})

describe('ringSegments', () => {
  it('places two equal segments with a gap centred on each boundary and badges at the middle', () => {
    const [first, second] = ringSegments(
      [segment({ index: 1, state: 'ok' }), segment({ index: 2, state: 'ok' })],
      { radius: 80, gapDeg: 4 }
    )
    expect(first.d).toBe('M 112.79 30.05 A 80 80 0 0 1 112.79 189.95')
    expect(first.badge).toEqual({ x: 210, y: 110 })
    expect(second.badge).toEqual({ x: 10, y: 110 })
    expect(first.fillD).toBeNull()
  })

  it('keeps a single account as one sweep that never closes into a full circle', () => {
    const [only] = ringSegments([segment({ index: 1, state: 'ok' })], { radius: 80, gapDeg: 0 })
    expect(only.d).toMatch(/ 0 1 1 /)
    expect(only.d).not.toBe('M 110 30 A 80 80 0 1 1 110 30')
  })

  it('fills the active segment to its remaining share and leaves other segments unfilled', () => {
    const [active, other] = ringSegments(
      [
        segment({ index: 1, state: 'active', remaining: 50 }),
        segment({ index: 2, state: 'spent', remaining: 50 })
      ],
      { radius: 80, gapDeg: 4 }
    )
    expect(active.fillD).not.toBeNull()
    expect(active.fillD).toMatch(/^M /)
    expect(other.fillD).toBeNull()
  })

  it('leaves the fill off an active segment with no reading', () => {
    const [active] = ringSegments([segment({ index: 1, state: 'active', remaining: null })], {
      radius: 80,
      gapDeg: 4
    })
    expect(active.fillD).toBeNull()
  })

  it('draws one inner ring per model scope inside the band, filled by what that model has left', () => {
    const [first, second] = ringSegments(
      [
        segment({ index: 1, state: 'active', models: { Fable: 50 } }),
        segment({ index: 2, state: 'ok', models: { Fable: null } })
      ],
      { radius: 80, gapDeg: 4, bandWidth: 14, modelScopes: ['Fable'] }
    )
    expect(first.models.map((m) => m.scope)).toEqual(['Fable'])
    // 80 - 7 (half band) - 7 (gap) - 3 (half ring): the first model ring sits at radius 63.
    expect(first.models[0]?.d).toMatch(/^M [\d.]+ [\d.]+ A 63 63 /)
    expect(first.models[0]?.fillD).toMatch(/^M /)
    expect(second.models[0]?.fillD).toBeNull()
  })

  it('draws no inner ring without model scopes', () => {
    const [only] = ringSegments([segment({ index: 1 })], { radius: 80, gapDeg: 4 })
    expect(only.models).toEqual([])
  })
})
