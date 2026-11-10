import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { listen } from "@tauri-apps/api/event";
import { Flame, Gauge, Mic } from "lucide-react";
import { commands, type UsageStats } from "@/bindings";
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
import { Badge } from "../../ui/Badge";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const osType = useOsType();
  const isLinux = type() === "linux";
  const speaksChinese =
    (getSetting("spoken_languages") ?? []).some(isChinese) ||
    (getSetting("chinese_script") ?? "as_transcribed") !== "as_transcribed";

  const [stats, setStats] = useState<UsageStats | null>(null);
  const [micLevels, setMicLevels] = useState<number[]>([
    0.2, 0.4, 0.3, 0.5, 0.3,
  ]);

  const bindings = getSetting("bindings");
  const dictateShortcut = bindings?.transcribe?.current_binding;

  useEffect(() => {
    commands.getUsageStats().then((res) => {
      if (res.status === "ok") setStats(res.data);
    });

    const unlistenLevels = listen<number[]>("mic-level", (event) => {
      if (event.payload && event.payload.length > 0) {
        setMicLevels(event.payload.slice(0, 5));
      }
    });

    const unlistenRecording = listen("recording-changed", () => {
      commands.getUsageStats().then((res) => {
        if (res.status === "ok") setStats(res.data);
      });
    });

    return () => {
      unlistenLevels.then((fn) => fn());
      unlistenRecording.then((fn) => fn());
    };
  }, []);

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      {/* Clean Status & Ready Hero */}
      <div className="rounded-2xl border border-line bg-surface/80 p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <h2 className="text-base font-semibold text-text">
                {t("sidebar.status.ready", {
                  defaultValue: "Ready to Dictate",
                })}
              </h2>
            </div>
            <p className="text-xs text-ink-3">
              {t("flow.holdToDictateBody", {
                defaultValue: "Press your shortcut in any text box to dictate.",
              })}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Mic Meter */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-line shadow-2xs">
              <Mic size={13} className="text-logo-primary" />
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
            </div>

            {/* Shortcut Pill */}
            {dictateShortcut && (
              <Badge
                variant="brand"
                className="font-mono text-xs px-3 py-1 font-semibold shadow-2xs"
              >
                {formatKeyCombination(dictateShortcut, osType)}
              </Badge>
            )}
          </div>
        </div>

        {/* Minimal Stats */}
        {stats && stats.total_words > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-3 pt-3 border-t border-line/60">
            <span className="inline-flex items-center gap-1.5 font-medium text-text">
              <Flame size={13} className="text-amber-500" />
              {t("stats.days", { count: stats.streak_days })}
            </span>
            <span className="text-line-strong">•</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-text">
              <Mic size={13} className="text-logo-primary" />
              {stats.total_words.toLocaleString()} {t("stats.totalWords")}
            </span>
            <span className="text-line-strong">•</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-text">
              <Gauge size={13} className="text-teal-600" />
              {t("stats.wpm", { count: Math.round(stats.average_wpm) })}
            </span>
          </div>
        )}
      </div>

      {/* Settings Groups */}
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutActivationSetting descriptionMode="tooltip" grouped={true} />
        {!isLinux && <ShortcutInput shortcutId="cancel" grouped={true} />}
      </SettingsGroup>

      <ModelSettingsCard />

      <SettingsGroup title={t("settings.languages.title")}>
        <PreferredLanguages descriptionMode="tooltip" grouped={true} />
        {speaksChinese && (
          <ChineseScriptSetting descriptionMode="tooltip" grouped={true} />
        )}
      </SettingsGroup>

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
