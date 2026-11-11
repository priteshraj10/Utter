import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { fieldClasses } from "./Input";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        fieldClasses,
        "resize-y leading-relaxed",
        variant === "compact" ? "min-h-20 px-2 py-1.5" : "min-h-24 px-3 py-2",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
