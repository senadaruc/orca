import type { GrazrRingSegment, GrazrSegmentState } from '../../../../shared/grazr-rotation-view'

// A port of the plugin's lib/panel.mjs ring maths, kept in the same 220 by 220 viewBox.
const RING_CENTRE = 110
const BADGE_OFFSET = 20
const MIN_SWEEP = 0.1
const MAX_SWEEP = 359.9

export type GrazrRingPath = {
  index: number
  d: string
  fillD: string | null
  badge: { x: number; y: number }
  state: GrazrSegmentState
}

const round = (n: number): number => Number(n.toFixed(2))

// Angles run clockwise from twelve o clock, as the plugin's ring does.
function pointAt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const angle = (deg * Math.PI) / 180
  return [round(cx + r * Math.sin(angle)), round(cy - r * Math.cos(angle))]
}

// Why: the sweep is clamped so a full 0 to 360 request never draws a degenerate arc.
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const sweep = Math.min(Math.max(endDeg - startDeg, MIN_SWEEP), MAX_SWEEP)
  const [x1, y1] = pointAt(cx, cy, r, startDeg)
  const [x2, y2] = pointAt(cx, cy, r, startDeg + sweep)
  const large = sweep > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

// Equal segments with a gap centred on each boundary; the fill arc shows the active account's remaining share.
export function ringSegments(
  segments: GrazrRingSegment[],
  { radius, gapDeg }: { radius: number; gapDeg: number }
): GrazrRingPath[] {
  const step = segments.length > 0 ? 360 / segments.length : 0
  return segments.map((segment, i) => {
    const start = i * step + gapDeg / 2
    const end = start + step - gapDeg
    const share = Math.min(segment.remaining ?? 0, 100) / 100
    const fillD =
      segment.state === 'active' && typeof segment.remaining === 'number' && segment.remaining > 0
        ? arcPath(RING_CENTRE, RING_CENTRE, radius, start, start + (end - start) * share)
        : null
    const [x, y] = pointAt(
      RING_CENTRE,
      RING_CENTRE,
      radius + BADGE_OFFSET,
      start + (end - start) / 2
    )
    return {
      index: segment.index,
      d: arcPath(RING_CENTRE, RING_CENTRE, radius, start, end),
      fillD,
      badge: { x, y },
      state: segment.state
    }
  })
}
