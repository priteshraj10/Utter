import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

/** A titled card of setting rows, separated by hairlines. */
export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => (
  <section className="space-y-2">
    {title && (
      <div className="px-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    )}
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="divide-y divide-border">{children}</div>
    </div>
  </section>
);
