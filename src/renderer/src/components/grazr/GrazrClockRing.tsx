import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GrazrRingSegment, GrazrRotationCentre } from '../../../../shared/grazr-rotation-view'
import { MODEL_RING_WIDTH, ringSegments } from './grazr-ring-geometry'
import {
  ACCOUNT_NEXT_CLASS,
  CENTRE_TONE_CLASS,
  MODEL_RING_TRACK_CLASS,
  RING_FILL_CLASS,
  SEGMENT_CLASS
} from './grazr-ring-colors'

const RING = { radius: 80, gapDeg: 4 }
const BAND_WIDTH = 14
// Why: the next segment is an outline, so its stroke is a third of the band and dashed.
const OUTLINE_WIDTH = 5
const OUTLINE_DASH = '8 4'

// Why: the centre is HTML capped at 60% of the diameter, so long names and hints truncate inside the ring hole.
// With model rings inside the band the hole is smaller, so the cap tightens.
export function GrazrClockRing({
  segments,
  centre,
  modelScopes
}: {
  segments: GrazrRingSegment[]
  centre: GrazrRotationCentre
  modelScopes: string[]
}): React.JSX.Element {
  const paths = ringSegments(segments, { ...RING, bandWidth: BAND_WIDTH, modelScopes })
  return (
    <div className="space-y-2">
      <div className="relative mx-auto h-72 w-72">
        <svg
          viewBox="0 0 220 220"
          role="img"
          aria-label={translate('grazr.dialog.ringLabel', 'Rotation order around the clock')}
          className="absolute inset-0 h-full w-full"
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
                  className={`stroke-current ${RING_FILL_CLASS}`}
                />
              )}
              {path.models.map((model) => (
                <g key={model.scope}>
                  <path
                    d={model.d}
                    fill="none"
                    strokeWidth={MODEL_RING_WIDTH}
                    className={`stroke-current ${MODEL_RING_TRACK_CLASS}`}
                  />
                  {model.fillD && (
                    <path
                      d={model.fillD}
                      fill="none"
                      strokeWidth={MODEL_RING_WIDTH}
                      className={`stroke-current ${SEGMENT_CLASS[path.state === 'next' ? 'ok' : path.state]}`}
                    />
                  )}
                </g>
              ))}
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
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              'flex min-w-0 flex-col items-center gap-0.5 text-center',
              modelScopes.length > 0 ? 'max-w-[50%]' : 'max-w-[60%]'
            )}
          >
            <div className="w-full truncate text-sm" title={centre.name}>
              {centre.name}
            </div>
            <div
              className={cn('text-xl font-semibold tabular-nums', CENTRE_TONE_CLASS[centre.tone])}
            >
              {centre.percentText}
            </div>
            {centre.modelLines.map((line) => (
              <div
                key={line}
                className={cn(
                  'w-full truncate text-xs tabular-nums',
                  CENTRE_TONE_CLASS[centre.tone]
                )}
              >
                {line}
              </div>
            ))}
            <div className="text-xs text-muted-foreground">{centre.hint}</div>
            <div className={cn('mt-1 text-xs', ACCOUNT_NEXT_CLASS)}>
              {translate('grazr.dialog.nextMarker', 'next ▸')}
            </div>
            <div className={cn('w-full truncate text-xs', ACCOUNT_NEXT_CLASS)}>
              {centre.next ?? translate('grazr.dialog.noNextAccount', 'none')}
            </div>
          </div>
        </div>
      </div>
      {modelScopes.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {translate('grazr.dialog.ringLegend', 'Outer ring: all models · inner: {{models}}', {
            models: modelScopes.join(', ')
          })}
        </p>
      )}
    </div>
  )
}
