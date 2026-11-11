import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        "primary-soft":
          "border-transparent bg-primary/10 text-primary hover:bg-primary/15",
        secondary:
          "border-border bg-card text-foreground shadow-xs hover:bg-accent",
        outline: "border-input bg-background text-foreground hover:bg-accent",
        warning:
          "border-border bg-card text-foreground hover:bg-warning-wash hover:border-warning",
        danger:
          "border-transparent bg-destructive text-white shadow-xs hover:bg-destructive/90",
        "danger-ghost":
          "border-transparent text-destructive hover:bg-error-wash",
        ghost: "border-transparent text-current hover:bg-accent",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3.5 text-sm",
        lg: "h-10 px-5 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
