import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        accent:
          "border-primary/20 bg-accent text-accent-foreground [a&]:hover:bg-accent/80",
        success:
          "border-success/25 bg-success-soft text-success-soft-foreground [a&]:hover:bg-success-soft/90",
        warning:
          "border-warning/25 bg-warning-soft text-warning-soft-foreground [a&]:hover:bg-warning-soft/90",
        info:
          "border-info/25 bg-info-soft text-info-soft-foreground [a&]:hover:bg-info-soft/90",
        neutral:
          "border-neutral/25 bg-neutral-soft text-neutral-soft-foreground [a&]:hover:bg-neutral-soft/90",
        review:
          "border-review-due/18 bg-review-due-soft text-review-due-soft-foreground [a&]:hover:bg-review-due-soft/90",
        destructive:
          "bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        "destructive-soft":
          "border-destructive/25 bg-destructive-soft text-destructive-soft-foreground [a&]:hover:bg-destructive-soft/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
