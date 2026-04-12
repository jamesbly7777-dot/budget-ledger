import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-sm transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm font-mono",
          className
        )}
        style={{
          borderColor: "rgba(56,155,255,0.2)",
          backgroundColor: "rgba(56,155,255,0.04)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(56,155,255,0.7)";
          e.currentTarget.style.boxShadow = "0 0 0 1px rgba(56,155,255,0.3), 0 0 16px rgba(56,155,255,0.15)";
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(56,155,255,0.2)";
          e.currentTarget.style.boxShadow = "";
          props.onBlur?.(e);
        }}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
