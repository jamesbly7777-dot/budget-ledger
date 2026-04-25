import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
        glowOrange:
          "rounded-full border border-[#ff8c00]/90 bg-[hsl(28_90%_12%)] text-white font-mono uppercase tracking-wide shadow-[0_0_14px_-2px_hsl(32_100%_50%_/_.55)]",
        glowCyan:
          "rounded-full border border-[#00d4ff]/90 bg-[hsl(200_90%_12%)] text-white font-mono uppercase tracking-wide shadow-[0_0_14px_-2px_hsl(187_100%_52%_/_.55)]",
        glowRed:
          "rounded-full border border-red-400/90 bg-[hsl(350_60%_14%)] text-white font-mono uppercase tracking-wide shadow-[0_0_14px_-2px_hsl(0_90%_50%_/_.5)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
