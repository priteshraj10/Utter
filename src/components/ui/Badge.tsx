import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-logo-primary text-white shadow-2xs hover:bg-logo-primary/90",
        primary:
          "border-transparent bg-logo-primary text-white shadow-2xs hover:bg-logo-primary/90",
        secondary:
          "border-transparent bg-sidebar text-ink-1 hover:bg-sidebar/80 border border-line",
        destructive:
          "border-transparent bg-error/15 text-error hover:bg-error/20",
        outline: "text-text border border-line bg-surface/50",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        brand:
          "border-transparent bg-logo-primary/15 text-logo-primary font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge: React.FC<BadgeProps> = ({ className, variant, ...props }) => {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
};

export { Badge };
export default Badge;
