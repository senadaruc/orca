import { translate } from '@/i18n/i18n'
import type {
  GrazrRingSegment,
  GrazrRotationCentre,
  GrazrSegmentState
} from '../../../../shared/grazr-rotation-view'
import { ringSegments } from './grazr-ring-geometry'

const RING = { radius: 80, gapDeg: 4 }
const NAME_MAX = 22
const BAND_WIDTH = 14
// Why: the next segment is an outline, so its stroke is a third of the band and dashed.
const OUTLINE_WIDTH = 5
const OUTLINE_DASH = '8 4'

// Why: stroke-current and fill-current take these tokens, so the ring follows the theme.
const SEGMENT_CLASS: Record<GrazrSegmentState, string> = {
  ok: 'text-muted-foreground/40',
  active: 'text-muted-foreground/40',
  next: 'text-foreground',
  spent: 'text-muted-foreground/20',
  blocked: 'text-destructive',
  unknown: 'text-muted-foreground/20'
}

function shortName(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name
}

export function GrazrClockRing({
  segments,
  centre
}: {
  segments: GrazrRingSegment[]
  centre: GrazrRotationCentre
}): React.JSX.Element {
  const paths = ringSegments(segments, RING)
  return (
    <svg
      viewBox="0 0 220 220"
      role="img"
      aria-label={translate('grazr.dialog.ringLabel', 'Rotation order around the clock')}
      className="mx-auto h-56 w-56"
    >
      {paths.map((path) => (
        <g key={path.index}>
          <path
            d={path.d}
            fill="none"
            strokeWidth={path.state === 'next' ? OUTLINE_WIDTH : BAND_WIDTH}
            strokeDasharray={path.state === 'next' ? OUTLINE_DASH : undefined}
            className={`stroke-current ${SEGMENT_CLASS[path.state]}`}
          />
          {path.fillD && (
            <path
              d={path.fillD}
              fill="none"
              strokeWidth={BAND_WIDTH}
              className="stroke-current text-foreground"
            />
          )}
          <text
            x={path.badge.x}
            y={path.badge.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            className="fill-current text-muted-foreground"
          >
            {path.index}
          </text>
        </g>
      ))}
      <text
        x={110}
        y={96}
        textAnchor="middle"
        fontSize={13}
        className="fill-current text-foreground"
      >
        <title>{centre.name}</title>
        {shortName(centre.name)}
      </text>
      <text
        x={110}
        y={124}
        textAnchor="middle"
        fontSize={20}
        className="fill-current text-foreground"
      >
        {centre.percentText}
      </text>
      <text
        x={110}
        y={146}
        textAnchor="middle"
        fontSize={10}
        className="fill-current text-muted-foreground"
      >
        {centre.hint}
      </text>
      <text
        x={110}
        y={166}
        textAnchor="middle"
        fontSize={10}
        className="fill-current text-muted-foreground"
      >
        {centre.next}
      </text>
    </svg>
  )
}
