import React from "react";
import { cn } from "@/lib/utils/cn";
import { InfoTooltip } from "./InfoTooltip";

interface SettingContainerProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Inline shows the description under the title; tooltip hides it behind an info icon. */
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
}

/** One settings row: label and description on one side, the control on the other. */
export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "inline",
  grouped = false,
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
}) => {
  const label = (
    <div className={cn("min-w-0", disabled && "opacity-50")}>
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {descriptionMode === "tooltip" && description && (
          <InfoTooltip
            text={description}
            placement={tooltipPosition === "bottom" ? "below" : "above"}
          />
        )}
      </div>
      {descriptionMode === "inline" && description && (
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );

  const frame = grouped
    ? "px-4 py-3"
    : "px-4 py-3 rounded-xl border border-border bg-card";

  if (layout === "stacked") {
    return (
      <div className={frame}>
        <div className="mb-2.5">{label}</div>
        <div className="w-full">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex min-h-14 items-center justify-between gap-6", frame)}
    >
      <div className="flex-1 min-w-0 max-w-[65%]">{label}</div>
      <div className="relative shrink-0">{children}</div>
    </div>
  );
};
