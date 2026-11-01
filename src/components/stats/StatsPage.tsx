import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events, type UsageStats } from "@/bindings";
import { SettingsGroup } from "../ui/SettingsGroup";

const Tile: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-lg border border-line bg-background p-4">
    <p className="text-xs font-medium text-ink-3 uppercase tracking-wide">
      {label}
    </p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {hint && <p className="text-xs text-ink-3 mt-0.5">{hint}</p>}
  </div>
);

export const StatsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      const result = await commands.getUsageStats();
      if (result.status === "ok") setStats(result.data);
    };
    load();
    // Refresh after each dictation.
    const unlisten = events.transcriptionCompleteEvent.listen(() => {
      setTimeout(load, 300);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const number = (n: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
      n,
    );
  const minutes = (seconds: number) =>
    seconds >= 3600
      ? t("stats.hours", { count: Math.round((seconds / 3600) * 10) / 10 })
      : t("stats.minutes", { count: Math.round(seconds / 60) });
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
    }).format(new Date(`${day}T12:00:00`));

  if (!stats) {
    return (
      <div className="max-w-3xl w-full mx-auto text-sm text-ink-3 p-4">
        {t("stats.loading")}
      </div>
    );
  }

  const maxWords = Math.max(1, ...stats.daily_words.map((d) => d.words));
  const maxApp = Math.max(1, ...stats.top_apps.map((a) => a.words));

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile label={t("stats.totalWords")} value={number(stats.total_words)} />
        <Tile
          label={t("stats.timeSaved")}
          value={minutes(stats.time_saved_seconds)}
          hint={t("stats.timeSavedHint")}
        />
        <Tile
          label={t("stats.speed")}
          value={t("stats.wpm", { count: Math.round(stats.average_wpm) })}
          hint={t("stats.speedHint")}
        />
        <Tile label={t("stats.today")} value={number(stats.words_today)} />
        <Tile label={t("stats.week")} value={number(stats.words_this_week)} />
        <Tile
          label={t("stats.streak")}
          value={t("stats.days", { count: stats.streak_days })}
          hint={t("stats.dictations", { count: stats.total_dictations })}
        />
      </div>

      <SettingsGroup title={t("stats.dailyTitle")}>
        <div className="p-4">
          <div className="h-5 text-sm text-ink-2 tabular-nums">
            {hovered !== null &&
              t("stats.dayTooltip", {
                day: dayLabel(stats.daily_words[hovered].day),
                words: number(stats.daily_words[hovered].words),
              })}
          </div>
          <div
            className="flex items-end gap-[2px] h-32 border-b border-line"
            role="img"
            aria-label={t("stats.dailyTitle")}
          >
            {stats.daily_words.map((d, i) => (
              <div
                key={d.day}
                className="flex-1 h-full flex items-end cursor-default"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className={`w-full rounded-t-[4px] bg-logo-primary transition-opacity ${
                    hovered === null || hovered === i
                      ? "opacity-100"
                      : "opacity-50"
                  }`}
                  style={{
                    height: d.words ? `${(d.words / maxWords) * 100}%` : 0,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-ink-3 mt-1">
            <span>{dayLabel(stats.daily_words[0].day)}</span>
            <span>{t("stats.todayShort")}</span>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("stats.appsTitle")}>
        <div className="p-4 space-y-2">
          {stats.top_apps.length === 0 && (
            <p className="text-sm text-ink-3">{t("stats.noApps")}</p>
          )}
          {stats.top_apps.map((app) => (
            <div key={app.app} className="flex items-center gap-3 text-sm">
              <span className="w-36 truncate">{app.app}</span>
              <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                <div
                  className="h-full rounded-full bg-logo-primary"
                  style={{ width: `${(app.words / maxApp) * 100}%` }}
                />
              </div>
              <span className="w-16 text-right tabular-nums text-ink-2">
                {number(app.words)}
              </span>
            </div>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
};
