import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Cyberpunk / neon — all variants use high-contrast text for readability */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(230_55%_5%)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "border-2 border-[#00d4ff] bg-[hsl(220_55%_7%)] text-white shadow-[0_0_20px_-2px_hsl(187_100%_52%_/_.65),0_0_36px_-8px_hsl(187_100%_55%_/_.35),inset_0_1px_0_hsl(190_100%_75%_/_.14)] hover:bg-[hsl(220_50%_11%)] hover:shadow-[0_0_28px_0_hsl(187_100%_58%_/_.7)] hover:border-[#5cefff]",
        destructive:
          "border-2 border-rose-400 bg-[hsl(350_40%_12%)] text-white shadow-[0_0_18px_-4px_hsl(350_90%_50%_/_.45)] hover:shadow-[0_0_24px_-2px_hsl(350_90%_55%_/_.55)] hover:border-rose-300",
        outline:
          "border-2 border-cyan-400/70 bg-black/30 text-white backdrop-blur-sm shadow-[0_0_14px_-6px_hsl(190_100%_50%_/_.4)] hover:bg-cyan-500/15 hover:border-cyan-300 hover:shadow-[0_0_22px_-4px_hsl(190_100%_50%_/_.5)]",
        secondary:
          "border-2 border-[#ff8c00] bg-[hsl(28_85%_10%)] text-white shadow-[0_0_20px_-2px_hsl(32_100%_50%_/_.55),0_0_32px_-8px_hsl(28_100%_45%_/_.3),inset_0_1px_0_hsl(40_100%_60%_/_.12)] hover:bg-[hsl(28_80%_13%)] hover:shadow-[0_0_28px_0_hsl(32_100%_55%_/_.65)] hover:border-[#ffb347]",
        ghost:
          "border border-transparent text-zinc-100 hover:bg-white/10 hover:border-cyan-500/30",
        link: "border-0 text-cyan-300 underline-offset-4 hover:underline hover:text-cyan-200",
        neonMagenta:
          "border-2 border-fuchsia-400 bg-[hsl(290_40%_12%)] text-white shadow-[0_0_20px_-4px_hsl(300_100%_55%_/_.45)] hover:shadow-[0_0_28px_-2px_hsl(300_100%_60%_/_.55)] hover:border-fuchsia-300",
      },
      size: {
        default: "min-h-10 px-4 py-2 text-sm",
        sm: "min-h-9 rounded-md px-3 text-xs",
        lg: "min-h-11 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
