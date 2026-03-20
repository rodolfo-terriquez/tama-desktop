import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toastVariants = cva(
  "shadow-card-surface rounded-lg px-4 py-2.5 text-sm font-medium",
  {
    variants: {
      tone: {
        default: "bg-card text-card-foreground",
        success: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        info: "bg-info text-info-foreground",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  }
)

export function Toast({
  className,
  tone,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof toastVariants>) {
  return (
    <div
      data-slot="toast"
      role="status"
      className={cn(toastVariants({ tone }), className)}
      {...props}
    />
  )
}
