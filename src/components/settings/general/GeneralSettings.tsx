import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { listen } from "@tauri-apps/api/event";
import {
  BookOpen,
  Check,
  Copy,
  Flame,
  Gauge,
  Mic,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  events,
  type HistoryEntry,
  type UsageStats,
} from "@/bindings";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ChannelSelector } from "../ChannelSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { ShortcutActivationSetting } from "../ShortcutActivation";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";
import { PreferredLanguages } from "../PreferredLanguages";
import { ChineseScriptSetting } from "../ChineseScript";
import { isChinese } from "@/lib/utils/languageSuggestions";
import { Button } from "../../ui/Button";
import { copyToClipboard } from "../history/clipboard";

const groupEntriesByDay = (
  entries: HistoryEntry[],
  todayLabel: string,
  yesterdayLabel: string,
) => {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: Array<{ label: string; items: HistoryEntry[] }> = [];
  for (const entry of entries) {
    const ms = entry.timestamp * 1000;
    let label: string;
    if (ms >= todayStart) {
      label = todayLabel;
    } else if (ms >= yesterdayStart) {
      label = yesterdayLabel;
    } else {
      label = new Date(ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(entry);
    } else {
      groups.push({ label, items: [entry] });
    }
  }
  return groups;
};

const FlowHomeHub: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const { getSetting, updateSetting, refreshSettings } = useSettings();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [micLevels, setMicLevels] = useState<number[]>(Array(7).fill(0));

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<number[]>("mic-level", (event) => {
      if (!cancelled) {
        setMicLevels(event.payload.slice(0, 7));
      }
    })
      .then((un) => {
        if (cancelled) {
          un();
        } else {
          unlistenFn = un;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const bindings = getSetting("bindings");
  const dictateKey = bindings?.transcribe?.current_binding;
  const commandKey = bindings?.command_mode?.current_binding;
  const noteKey = bindings?.voice_note?.current_binding;

  const loadData = useCallback(async () => {
    const [statsRes, histRes] = await Promise.all([
      commands.getUsageStats(),
      commands.getHistoryEntries(null, 25),
    ]);
    if (statsRes.status === "ok") setStats(statsRes.data);
    if (histRes.status === "ok") setEntries(histRes.data.entries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadData();

    let unlistenCompleteFn: (() => void) | null = null;
    let unlistenHistoryFn: (() => void) | null = null;

    events.transcriptionCompleteEvent
      .listen(() => {
        if (!cancelled) void loadData();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenCompleteFn = fn;
      })
      .catch(() => {});

    events.historyUpdatePayload
      .listen(() => {
        if (!cancelled) void loadData();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenHistoryFn = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenCompleteFn) unlistenCompleteFn();
      if (unlistenHistoryFn) unlistenHistoryFn();
    };
  }, [loadData]);

  const handleLearnFromEdit = async (original: string) => {
    const res = await commands.learnWordsFromEdit(original, editDraft);
    if (res.status === "ok") {
      await refreshSettings();
      await copyToClipboard(editDraft);
      if (res.data.length > 0) {
        toast.success(
          t("settings.history.learnedWords", {
            words: res.data.join(", "),
          }),
        );
      } else {
        toast.info(t("settings.history.noNewWordsLearned"));
      }
      setEditingId(null);
    } else {
      toast.error(res.error);
    }
  };

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery.trim()) return true;
    const text = (
      entry.post_processed_text ||
      entry.transcription_text ||
      ""
    ).toLowerCase();
    return text.includes(searchQuery.trim().toLowerCase());
  });

  const dayGroups = groupEntriesByDay(
    filteredEntries,
    t("flow.todaysDictations"),
    t("flow.yesterdaysDictations"),
  );

  const wpmVal = stats ? Math.round(stats.average_wpm) : 0;
  const topAppsCount = stats ? stats.top_apps.length : 0;

  return (
    <div className="space-y-5">
      {/* Wispr Flow Top Editorial Header + 4-Pill Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <div>
          <h1
            className="text-3xl font-normal text-text tracking-tight"
            style={{
              fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
            }}
          >
            {t("flow.welcomeBack")}
          </h1>
          <p className="text-xs text-ink-3 mt-1">{t("flow.heroSubtitle")}</p>
        </div>

        {/* Wispr Flow Compact 4-Stat Pill Bar */}
        {stats && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 shadow-2xs text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-text pr-2 border-r border-line">
              <Flame size={13} className="text-amber-500" />
              {t("stats.days", { count: stats.streak_days })}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-text px-2 border-r border-line">
              <Mic size={13} className="text-logo-primary" />
              {stats.total_words.toLocaleString()}{" "}
              <span className="text-ink-3 font-normal">
                {t("stats.totalWords")}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-text px-2 border-r border-line">
              <Gauge size={13} className="text-teal-600" />
              {t("stats.wpm", { count: wpmVal })}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-text pl-2">
              <Sparkles size={13} className="text-logo-primary" />
              {topAppsCount}{" "}
              <span className="text-ink-3 font-normal">
                {t("flow.appsPill")}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Wispr Flow Lavender Hero Callout Banner */}
      <div
        className="rounded-2xl border border-line p-5 space-y-4 shadow-2xs"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-logo-primary) 10%, var(--color-surface)) 0%, var(--color-surface) 100%)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-xl">
            <h2
              className="text-2xl text-text font-normal leading-snug"
              style={{
                fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
              }}
            >
              {t("flow.holdToDictateHeading", {
                shortcut: dictateKey
                  ? formatKeyCombination(dictateKey, osType)
                  : "Option+Space",
              })}
            </h2>
            <p className="text-xs text-ink-2 leading-relaxed">
              {t("flow.holdToDictateBody")}
            </p>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-line shadow-2xs">
            <Mic size={12} className="text-logo-primary" />
            <div className="flex items-center gap-0.5 h-3">
              {micLevels.map((lvl, idx) => (
                <span
                  key={`mic-level-${idx}`}
                  className="w-1 rounded-full bg-logo-primary transition-all duration-75"
                  style={{
                    height: `${Math.max(3, Math.min(14, lvl * 14))}px`,
                  }}
                />
              ))}
            </div>
            <span className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider pl-1">
              {t("settings.general.micActive")}
            </span>
          </div>
        </div>

        {/* Active Shortcuts & Screen Context Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-line/70">
          <div className="rounded-xl bg-surface/90 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutDictate")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-sidebar border border-line text-text shrink-0">
              {dictateKey ? formatKeyCombination(dictateKey, osType) : "—"}
            </kbd>
          </div>
          <div className="rounded-xl bg-surface/90 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutCommand")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-sidebar border border-line text-text shrink-0">
              {commandKey ? formatKeyCombination(commandKey, osType) : "—"}
            </kbd>
          </div>
          <div className="rounded-xl bg-surface/90 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutNote")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-sidebar border border-line text-text shrink-0">
              {noteKey ? formatKeyCombination(noteKey, osType) : "—"}
            </kbd>
          </div>
        </div>
      </div>

      {/* Wispr Flow Chronological Dictation Feed (Today's dictations / Yesterday's dictations) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("flow.recentDictationsTitle")}
          </h3>
          <label className="flex items-center gap-2 px-3 py-1 rounded-lg border border-line bg-surface focus-within:border-logo-primary w-64">
            <Search size={13} className="text-ink-3 shrink-0" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("settings.history.searchPlaceholder")}
              className="w-full bg-transparent text-xs outline-none"
            />
          </label>
        </div>

        {dayGroups.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center space-y-1">
            <p className="text-sm font-medium text-text">
              {t("settings.history.empty")}
            </p>
            <p className="text-xs text-ink-3">{t("flow.emptyFeedSubtitle")}</p>
          </div>
        ) : (
          dayGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <h4 className="text-xs font-medium text-ink-3 px-1">
                {group.label}
              </h4>
              <div className="rounded-2xl border border-line bg-surface divide-y divide-line overflow-hidden shadow-2xs">
                {group.items.map((entry) => {
                  const displayed =
                    entry.post_processed_text || entry.transcription_text;
                  const timeStr = new Date(
                    entry.timestamp * 1000,
                  ).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isEditing = editingId === entry.id;

                  return (
                    <div
                      key={entry.id}
                      className="px-4 py-3.5 hover:bg-sidebar/40 transition-colors flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <span className="text-xs text-ink-3 font-mono w-16 shrink-0 pt-0.5">
                            {timeStr}
                          </span>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  className="w-full min-h-[64px] rounded-lg border border-line bg-background p-2.5 text-sm outline-none focus:border-logo-primary"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-tag text-ink-3">
                                    {t("settings.history.learnWordsHint")}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => setEditingId(null)}
                                    >
                                      {t("common.close")}
                                    </Button>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() =>
                                        handleLearnFromEdit(displayed)
                                      }
                                    >
                                      {t("settings.history.learnAndCopy")}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-text leading-relaxed whitespace-pre-wrap wrap-break-word select-text">
                                {displayed ||
                                  t("settings.history.notTranscribed")}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Row Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(isEditing ? null : entry.id);
                              setEditDraft(displayed);
                            }}
                            className="p-1.5 rounded-md text-ink-3 hover:text-text hover:bg-sidebar cursor-pointer"
                            title={t("settings.history.editAndLearn")}
                          >
                            <BookOpen size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (await copyToClipboard(displayed)) {
                                setCopiedId(entry.id);
                                setTimeout(() => setCopiedId(null), 1500);
                              }
                            }}
                            className="p-1.5 rounded-md text-ink-3 hover:text-text hover:bg-sidebar cursor-pointer"
                            title={t("settings.history.copyToClipboard")}
                          >
                            {copiedId === entry.id ? (
                              <Check size={14} className="text-moss" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void commands.retryHistoryEntryTranscription(
                                entry.id,
                              );
                            }}
                            className="p-1.5 rounded-md text-ink-3 hover:text-text hover:bg-sidebar cursor-pointer"
                            title={t("settings.history.retranscribe")}
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await commands.deleteHistoryEntry(entry.id);
                              await loadData();
                            }}
                            className="p-1.5 rounded-md text-ink-3 hover:text-error hover:bg-sidebar cursor-pointer"
                            title={t("settings.history.delete")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const isLinux = type() === "linux";
  const speaksChinese =
    (getSetting("spoken_languages") ?? []).some(isChinese) ||
    (getSetting("chinese_script") ?? "as_transcribed") !== "as_transcribed";
  return (
    <div className="max-w-4xl w-full mx-auto space-y-6">
      <FlowHomeHub />
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutActivationSetting descriptionMode="tooltip" grouped={true} />
        {!isLinux && <ShortcutInput shortcutId="cancel" grouped={true} />}
      </SettingsGroup>
      <SettingsGroup title={t("settings.languages.title")}>
        <PreferredLanguages descriptionMode="tooltip" grouped={true} />
        {speaksChinese && (
          <ChineseScriptSetting descriptionMode="tooltip" grouped={true} />
        )}
      </SettingsGroup>
      <ModelSettingsCard />
      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <ChannelSelector descriptionMode="tooltip" grouped={true} />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!audioFeedbackEnabled}
        />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>
    </div>
  );
};
