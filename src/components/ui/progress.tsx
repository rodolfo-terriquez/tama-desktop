import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const progressVariants = cva(
  "relative w-full overflow-hidden rounded-full bg-muted",
  {
    variants: {
      size: {
        sm: "h-1.5",
        default: "h-2",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const progressIndicatorVariants = cva(
  "h-full rounded-full transition-[width] duration-300",
  {
    variants: {
      tone: {
        default: "bg-primary",
        success: "bg-success",
        warning: "bg-warning",
        info: "bg-info",
        destructive: "bg-destructive",
        neutral: "bg-neutral",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  }
)

export function Progress({
  className,
  indicatorClassName,
  size,
  tone,
  value = 0,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof progressVariants> &
  VariantProps<typeof progressIndicatorVariants> & {
    indicatorClassName?: string
    value?: number
  }) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div
      data-slot="progress"
      className={cn(progressVariants({ size, className }))}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(progressIndicatorVariants({ tone }), indicatorClassName)}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  )
}
