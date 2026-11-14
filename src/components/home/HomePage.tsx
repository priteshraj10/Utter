import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { commands, events, type UsageStats } from "@/bindings";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import { useSettings } from "@/hooks/useSettings";
import { navigateTo } from "@/lib/navigation";
import { HistorySettings } from "../settings/history/HistorySettings";

/** Home: how to dictate, how much you have, and everything you've said. */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();
  const [stats, setStats] = useState<UsageStats | null>(null);

  const dictateShortcut = getSetting("bindings")?.transcribe?.current_binding;

  useEffect(() => {
    const refresh = () =>
      commands.getUsageStats().then((res) => {
        if (res.status === "ok") setStats(res.data);
      });
    refresh();
    // A new dictation lands in History; refresh the stats with it.
    const unlisten = events.historyUpdatePayload.listen((event) => {
      if (event.payload.action === "added") refresh();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const statItems = stats
    ? [
        {
          value: stats.total_words.toLocaleString(),
          label: t("home.stats.words"),
        },
        {
          value: Math.round(stats.average_wpm).toLocaleString(),
          label: t("home.stats.wpm"),
        },
        {
          value: stats.streak_days.toLocaleString(),
          label: t("home.stats.streak", { count: stats.streak_days }),
        },
      ]
    : [];

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t("home.greeting.morning")
      : hour < 18
        ? t("home.greeting.afternoon")
        : t("home.greeting.evening");

  // Laid out like Flow's home: a welcome title, a banner, then your history
  // with the stats card beside it (above it in a narrow window).
  return (
    <div className="max-w-5xl w-full mx-auto space-y-6">
      <h1 className="px-1 pt-2 text-3xl font-semibold tracking-tight text-foreground">
        {greeting}
      </h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-6">
          <section className="relative overflow-hidden rounded-2xl bg-neutral-900 px-7 py-7 text-white shadow-sm dark:bg-neutral-800">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-gradient-to-br from-violet-400/40 via-sky-400/25 to-transparent blur-2xl"
            />
            <div className="relative max-w-md space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                {t("home.banner.title")}
              </h2>
              <p className="text-sm text-white/75">
                {dictateShortcut ? (
                  <Trans
                    i18nKey="home.body"
                    values={{
                      shortcut: formatKeyCombination(dictateShortcut, osType),
                    }}
                    components={{
                      kbd: (
                        <kbd className="mx-0.5 rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-xs font-medium text-white" />
                      ),
                    }}
                  />
                ) : (
                  t("home.bodyNoShortcut")
                )}
              </p>
              <button
                type="button"
                onClick={() => navigateTo("style")}
                className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white/90"
              >
                {t("home.banner.cta")}
              </button>
            </div>
          </section>

          <HistorySettings />
        </div>

        {stats && (
          <aside className="order-first lg:order-none">
            <div className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-0">
              <dl className="grid grid-cols-3 gap-4 lg:grid-cols-1">
                {statItems.map(({ value, label }) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <dd className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                      {value}
                    </dd>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
