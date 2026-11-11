import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const fieldClasses =
  "w-full rounded-lg border border-input bg-background text-sm text-foreground text-start shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        fieldClasses,
        variant === "compact" ? "h-7 px-2" : "h-9 px-3",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
