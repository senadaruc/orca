import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { GrazrWindowBar } from '../../../../shared/grazr-rotation-view'
import { WINDOW_FILL_CLASS, WINDOW_TEXT_CLASS } from './grazr-ring-colors'

// HerdrM's account card: one bar per usage window, with what is left and when it resets.
export function GrazrWindowBars({ windows }: { windows: GrazrWindowBar[] }): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {windows.map((window) => (
        <li key={window.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 truncate text-muted-foreground">{window.label}</span>
          <Progress
            value={window.left}
            className={cn('h-1.5 flex-1 bg-muted', WINDOW_FILL_CLASS[window.tone])}
          />
          <span
            className={cn('w-14 shrink-0 text-right tabular-nums', WINDOW_TEXT_CLASS[window.tone])}
          >
            {window.left}%
          </span>
          <span className="w-28 shrink-0 truncate text-right text-muted-foreground">
            {window.resetText}
          </span>
        </li>
      ))}
    </ul>
  )
}
