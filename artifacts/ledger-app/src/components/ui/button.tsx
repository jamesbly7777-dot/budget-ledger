import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 font-mono uppercase tracking-wider text-xs",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white border border-[#00d4ff]/60 font-bold shadow-[0_0_22px_rgba(0,212,255,0.55),0_2px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_0_38px_rgba(0,212,255,0.8),0_4px_12px_rgba(0,0,0,0.3)] hover:brightness-110 hover:border-[#00d4ff]/90 active:scale-[0.98] active:shadow-[0_0_14px_rgba(0,212,255,0.35)]",
        destructive:
          "bg-destructive text-white border-none font-bold shadow-[0_0_16px_rgba(239,68,68,0.4),0_2px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_0_26px_rgba(239,68,68,0.6)] hover:brightness-110 active:scale-[0.98]",
        outline:
          "border border-white/15 bg-transparent text-foreground hover:bg-white/6 hover:border-white/25 active:shadow-none",
        secondary:
          "bg-[#ff8c00]/90 text-white border border-[#ff8c00]/70 font-bold shadow-[0_0_20px_rgba(255,140,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_0_36px_rgba(255,140,0,0.75),0_4px_12px_rgba(0,0,0,0.3)] hover:brightness-110 hover:border-[#ff8c00] active:scale-[0.98]",
        ghost: "border border-transparent text-foreground hover:bg-white/6",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
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
