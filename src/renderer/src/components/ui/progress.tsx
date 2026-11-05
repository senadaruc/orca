import * as React from 'react'
import * as ProgressPrimitive from 'radix-ui/progress'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Why: a bar that reports a state (usage left, a quota) takes the status tone of that state.
const progressIndicatorVariants = cva('h-full w-full flex-1 transition-all duration-300 ease-out', {
  variants: {
    tone: {
      default: 'bg-primary',
      success: 'bg-status-success',
      warning: 'bg-status-warning',
      destructive: 'bg-destructive'
    }
  },
  defaultVariants: { tone: 'default' }
})

function Progress({
  className,
  value,
  tone,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone ?? 'default'}
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={progressIndicatorVariants({ tone })}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress, progressIndicatorVariants }
