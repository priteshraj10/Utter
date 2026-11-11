import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Flame, Gauge, Mic } from "lucide-react";
import { commands, events, type UsageStats } from "@/bindings";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import { useSettings } from "@/hooks/useSettings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
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
          icon: Mic,
          label: t("stats.totalWords"),
          value: stats.total_words.toLocaleString(),
        },
        {
          icon: Gauge,
          label: t("stats.speed"),
          value: t("stats.wpm", { count: Math.round(stats.average_wpm) }),
        },
        {
          icon: Flame,
          label: t("stats.streak"),
          value: t("stats.days", { count: stats.streak_days }),
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

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <h1 className="px-1 pt-2 text-2xl font-semibold tracking-tight text-foreground">
        {greeting}
      </h1>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>{t("home.title")}</CardTitle>
          <CardDescription className="text-sm">
            {dictateShortcut ? (
              <Trans
                i18nKey="home.body"
                values={{
                  shortcut: formatKeyCombination(dictateShortcut, osType),
                }}
                components={{
                  kbd: (
                    <kbd className="mx-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground" />
                  ),
                }}
              />
            ) : (
              t("home.bodyNoShortcut")
            )}
          </CardDescription>
        </CardHeader>
        {stats && stats.total_words > 0 && (
          <CardContent>
            <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
              {statItems.map(({ icon: Icon, label, value }) => (
                <div key={label} className="px-4 py-3">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon size={13} />
                    {label}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        )}
      </Card>
      <HistorySettings />
    </div>
  );
};
