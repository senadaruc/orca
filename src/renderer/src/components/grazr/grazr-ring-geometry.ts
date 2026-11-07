import type { GrazrRingSegment, GrazrSegmentState } from '../../../../shared/grazr-rotation-view'

// A port of the plugin's lib/panel.mjs ring maths, kept in the same 220 by 220 viewBox.
const RING_CENTRE = 110
const BADGE_OFFSET = 20
const MIN_SWEEP = 0.1
const MAX_SWEEP = 359.9
// HerdrM's dial: each model with a weekly limit of its own gets a thinner ring inside the band.
export const MODEL_RING_WIDTH = 6
const MODEL_RING_GAP = 7
const MODEL_RING_SPACING = 3

export type GrazrModelRingPath = {
  scope: string
  d: string
  fillD: string | null
}

export type GrazrRingPath = {
  index: number
  d: string
  fillD: string | null
  badge: { x: number; y: number }
  state: GrazrSegmentState
  models: GrazrModelRingPath[]
}

export type GrazrRingLayout = {
  radius: number
  gapDeg: number
  bandWidth?: number
  modelScopes?: string[]
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

// The first model ring sits a gap inside the band; each further one a spacing further in.
export function modelRingRadius(index: number, { radius, bandWidth = 0 }: GrazrRingLayout): number {
  return (
    radius -
    bandWidth / 2 -
    MODEL_RING_GAP -
    MODEL_RING_WIDTH / 2 -
    index * (MODEL_RING_WIDTH + MODEL_RING_SPACING)
  )
}

// Where the rings end towards the centre, so the centre text can stay inside the hole.
export function ringInnerEdge(layout: GrazrRingLayout): number {
  const scopes = layout.modelScopes ?? []
  return scopes.length === 0
    ? layout.radius - (layout.bandWidth ?? 0) / 2
    : modelRingRadius(scopes.length - 1, layout) - MODEL_RING_WIDTH / 2
}

function fillArc(radius: number, start: number, end: number, left: number | null): string | null {
  if (left === null || left <= 0) {
    return null
  }
  const share = Math.min(left, 100) / 100
  return arcPath(RING_CENTRE, RING_CENTRE, radius, start, start + (end - start) * share)
}

// Equal segments with a gap centred on each boundary; the fill arc shows the active account's remaining share.
// Each model ring is filled by what that account has left of the model's week.
export function ringSegments(
  segments: GrazrRingSegment[],
  layout: GrazrRingLayout
): GrazrRingPath[] {
  const { radius, gapDeg } = layout
  const scopes = layout.modelScopes ?? []
  const step = segments.length > 0 ? 360 / segments.length : 0
  return segments.map((segment, i) => {
    const start = i * step + gapDeg / 2
    const end = start + step - gapDeg
    const fillD = segment.state === 'active' ? fillArc(radius, start, end, segment.remaining) : null
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
      state: segment.state,
      models: scopes.map((scope, modelIndex) => {
        const modelRadius = modelRingRadius(modelIndex, layout)
        return {
          scope,
          d: arcPath(RING_CENTRE, RING_CENTRE, modelRadius, start, end),
          fillD: fillArc(modelRadius, start, end, segment.models[scope] ?? null)
        }
      })
    }
  })
}
