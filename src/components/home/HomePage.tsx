import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ShieldCheck, Cloud, FileText, Mic, MessageSquare, ChevronRight } from "lucide-react";
import {
  commands,
  events,
  type Note,
  type NoteChatSummary,
  type PrivacyStatus,
  type UsageStats,
} from "@/bindings";
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
  const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [recentChats, setRecentChats] = useState<NoteChatSummary[]>([]);

  const dictateShortcut = getSetting("bindings")?.transcribe?.current_binding;

  useEffect(() => {
    const refresh = () =>
      commands.getUsageStats().then((res) => {
        if (res.status === "ok") setStats(res.data);
      });
    refresh();
    commands.getPrivacyStatus().then(setPrivacy);
    commands.listNotes(null).then((res) => {
      if (res.status === "ok") setRecentNotes(res.data.slice(0, 3));
    });
    commands.listNoteChats().then((res) => {
      if (res.status === "ok") setRecentChats(res.data.slice(0, 3));
    });
    // A new dictation lands in History; refresh the stats with it.
    const unlisten = events.historyUpdatePayload.listen((event) => {
      if (event.payload.action === "added") refresh();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const formatTime = (seconds: number) => {
    const date = new Date(seconds * 1000);
    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

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
        ...(stats.typical_latency_seconds != null
          ? [
              {
                value: t("home.stats.seconds", {
                  value: stats.typical_latency_seconds.toFixed(1),
                }),
                label: t("home.stats.latency"),
              },
            ]
          : []),
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

        <aside className="order-first space-y-4 lg:order-none">
          {stats && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-1">
                {statItems.map(({ value, label }) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <dd className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                      {value}
                    </dd>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                  </div>
                ))}
              </dl>
              {privacy && (
                <div className="mt-4 border-t border-border pt-4 text-sm">
                  {privacy.on_device ? (
                    <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck size={16} className="shrink-0" />
                      {t("home.privacy.onDevice")}
                    </p>
                  ) : (
                    <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                      <Cloud size={16} className="mt-0.5 shrink-0" />
                      <span>
                        {t("home.privacy.cloud", {
                          provider: privacy.cloud_provider,
                        })}{" "}
                        <button
                          type="button"
                          onClick={() => navigateTo("settings", "advanced")}
                          className="underline underline-offset-2"
                        >
                          {t("home.privacy.change")}
                        </button>
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recent Notes */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <FileText size={15} className="text-muted-foreground" />
                {t("home.recentNotes")}
              </h3>
              <button
                type="button"
                onClick={() => navigateTo("notes")}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                {t("home.viewAll")}
                <ChevronRight size={13} />
              </button>
            </div>
            {recentNotes.length > 0 ? (
              <ul className="space-y-1.5">
                {recentNotes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => navigateTo("notes", undefined, "notes", note.id)}
                      className="w-full text-left p-2 rounded-lg hover:bg-accent/60 transition-colors group flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                          {note.title || t("notes.untitled")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(note.created_at)}
                        </p>
                      </div>
                      {note.kind === "voice" || note.kind === "meeting" ? (
                        <Mic size={13} className="shrink-0 mt-1 text-muted-foreground" />
                      ) : (
                        <FileText size={13} className="shrink-0 mt-1 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground py-2 text-center">
                {t("home.noRecentNotes")}
              </p>
            )}
          </div>

          {/* Ask your notes / Recent Chats */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <MessageSquare size={15} className="text-muted-foreground" />
                {t("home.recentChats")}
              </h3>
              <button
                type="button"
                onClick={() => navigateTo("notes", undefined, "ask")}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                {t("home.viewAll")}
                <ChevronRight size={13} />
              </button>
            </div>
            {recentChats.length > 0 ? (
              <ul className="space-y-1.5">
                {recentChats.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      onClick={() => navigateTo("notes", undefined, "ask")}
                      className="w-full text-left p-2 rounded-lg hover:bg-accent/60 transition-colors group flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                          {chat.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(chat.updated_at)}
                        </p>
                      </div>
                      <ChevronRight size={13} className="shrink-0 mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground py-2 text-center">
                {t("home.noRecentChats")}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
