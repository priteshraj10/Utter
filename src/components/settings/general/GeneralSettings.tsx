import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  Check,
  Copy,
  Flame,
  Gauge,
  Mic,
  NotebookPen,
  Sparkles,
  Timer,
  Volume2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { commands, events, type UsageStats } from "@/bindings";
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
import { Select } from "../../ui/Select";
import { copyToClipboard } from "../history/clipboard";

const QUICK_TRANSFORMS = [
  { id: "default_improve_transcriptions", key: "flow.transforms.cleanUp" },
  { id: "style_concise", key: "flow.transforms.concise" },
  { id: "style_formal", key: "flow.transforms.formal" },
  { id: "style_casual", key: "flow.transforms.casual" },
  { id: "style_email", key: "flow.transforms.email" },
  { id: "style_bullets", key: "flow.transforms.bullets" },
  { id: "style_code", key: "flow.transforms.code" },
  { id: "snippets_only", key: "flow.transforms.snippets" },
] as const;

const FlowStudioCard: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const { getSetting, updateSetting } = useSettings();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [scratchText, setScratchText] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [transforming, setTransforming] = useState(false);
  const [copied, setCopied] = useState(false);

  const bindings = getSetting("bindings");
  const dictateKey = bindings?.transcribe?.current_binding;
  const commandKey = bindings?.command_mode?.current_binding;
  const noteKey = bindings?.voice_note?.current_binding;

  const aiEnabled = getSetting("post_process_enabled") ?? false;
  const autoCleanup = getSetting("auto_cleanup") ?? false;
  const whisperMode = getSetting("whisper_mode") ?? false;
  const prompts = getSetting("post_process_prompts") ?? [];
  const selectedPromptId =
    getSetting("post_process_selected_prompt_id") ??
    "default_improve_transcriptions";

  const promptOptions = prompts.map((p) => ({ value: p.id, label: p.name }));

  useEffect(() => {
    const loadStats = async () => {
      const res = await commands.getUsageStats();
      if (res.status === "ok") setStats(res.data);
    };
    loadStats();
    const unlisten = events.transcriptionCompleteEvent.listen(() => {
      loadStats();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const runTransform = async (instruction: string) => {
    if (!scratchText.trim() || !instruction.trim()) return;
    setTransforming(true);
    const res = await commands.transformText(scratchText, instruction);
    setTransforming(false);
    if (res.status === "ok") {
      setScratchText(res.data);
    } else {
      toast.error(res.error);
    }
  };

  const handleCopy = async () => {
    if (!scratchText.trim()) return;
    if (await copyToClipboard(scratchText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleSaveAsNote = async () => {
    if (!scratchText.trim()) return;
    const firstLine =
      scratchText
        .split(/[.\n!?]/)[0]
        ?.trim()
        .slice(0, 60) || t("notes.untitled");
    const res = await commands.createNote(firstLine, scratchText.trim());
    if (res.status === "ok") {
      toast.success(t("flow.savedToNotes"));
    } else {
      toast.error(res.error);
    }
  };

  const savedMins = stats
    ? Math.max(0, Math.round(stats.time_saved_seconds / 60))
    : 0;

  return (
    <div className="space-y-4">
      {/* Hero Flow Banner */}
      <div className="rounded-xl border border-line bg-surface-1 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-1 flex items-center gap-2">
              <Sparkles size={17} className="text-logo-primary" />
              {t("flow.heroTitle")}
            </h2>
            <p className="text-xs text-ink-3 mt-0.5">
              {t("flow.heroSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!aiEnabled) {
                  await updateSetting("post_process_enabled", true);
                  await updateSetting("auto_cleanup", true);
                } else {
                  await updateSetting("auto_cleanup", !autoCleanup);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                aiEnabled && autoCleanup
                  ? "bg-logo-primary/20 border-logo-primary text-ink-1"
                  : "border-line text-ink-3 hover:border-ink-3"
              }`}
              title={t("settings.personalize.autoCleanup.description")}
            >
              <Wand2 size={12} />
              {t("flow.aiCleanupPill")}
            </button>
            <button
              type="button"
              onClick={() => updateSetting("whisper_mode", !whisperMode)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                whisperMode
                  ? "bg-logo-primary/20 border-logo-primary text-ink-1"
                  : "border-line text-ink-3 hover:border-ink-3"
              }`}
              title={t("settings.personalize.whisperMode.description")}
            >
              <Volume2 size={12} />
              {t("flow.whisperModePill")}
            </button>
            {promptOptions.length > 0 && (
              <Select
                className="w-40"
                value={selectedPromptId}
                options={promptOptions}
                onChange={(val) =>
                  val && updateSetting("post_process_selected_prompt_id", val)
                }
              />
            )}
          </div>
        </div>

        {/* Active Shortcuts Strip */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line">
          <div className="rounded-lg bg-background/70 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutDictate")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-line/70 text-ink-1 shrink-0">
              {dictateKey ? formatKeyCombination(dictateKey, osType) : "—"}
            </kbd>
          </div>
          <div className="rounded-lg bg-background/70 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutCommand")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-line/70 text-ink-1 shrink-0">
              {commandKey ? formatKeyCombination(commandKey, osType) : "—"}
            </kbd>
          </div>
          <div className="rounded-lg bg-background/70 border border-line px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3 truncate">
              {t("flow.shortcutNote")}
            </span>
            <kbd className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-line/70 text-ink-1 shrink-0">
              {noteKey ? formatKeyCombination(noteKey, osType) : "—"}
            </kbd>
          </div>
        </div>

        {/* Live Metrics Strip */}
        {stats && (
          <div className="grid grid-cols-4 gap-2 pt-1">
            <div className="rounded-lg bg-background/60 border border-line p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <Mic size={12} className="text-logo-primary" />
                <span>{t("stats.totalWords")}</span>
              </div>
              <p className="text-base font-semibold mt-0.5">
                {stats.total_words.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-background/60 border border-line p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <Gauge size={12} className="text-logo-primary" />
                <span>{t("stats.speed")}</span>
              </div>
              <p className="text-base font-semibold mt-0.5">
                {t("stats.wpm", { count: Math.round(stats.average_wpm) })}
              </p>
            </div>
            <div className="rounded-lg bg-background/60 border border-line p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <Timer size={12} className="text-logo-primary" />
                <span>{t("stats.timeSaved")}</span>
              </div>
              <p className="text-base font-semibold mt-0.5">
                {t("stats.minutes", { count: savedMins })}
              </p>
            </div>
            <div className="rounded-lg bg-background/60 border border-line p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <Flame size={12} className="text-logo-primary" />
                <span>{t("stats.streak")}</span>
              </div>
              <p className="text-base font-semibold mt-0.5">
                {t("stats.days", { count: stats.streak_days })}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Flow Scratchpad & AI Studio */}
      <SettingsGroup
        title={t("flow.scratchpadTitle")}
        description={t("flow.scratchpadDescription")}
      >
        <div className="p-4 space-y-3">
          <textarea
            value={scratchText}
            onChange={(e) => setScratchText(e.target.value)}
            placeholder={t("flow.scratchpadPlaceholder")}
            className="w-full min-h-[96px] rounded-lg border border-line bg-background p-3 text-sm leading-relaxed outline-none focus:border-logo-primary resize-y"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_TRANSFORMS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={transforming || !scratchText.trim()}
                onClick={() => runTransform(item.id)}
                className="px-2.5 py-1 rounded-md text-xs font-medium border border-line bg-background hover:border-logo-primary disabled:opacity-40 cursor-pointer transition-colors"
              >
                {t(item.key)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customCmd.trim()) {
                  void runTransform(customCmd);
                }
              }}
              placeholder={t("flow.customCommandPlaceholder")}
              className="flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-xs outline-none focus:border-logo-primary"
            />
            <Button
              variant="primary-soft"
              size="sm"
              disabled={
                transforming || !scratchText.trim() || !customCmd.trim()
              }
              onClick={() => runTransform(customCmd)}
            >
              <Wand2 size={13} className="mr-1" />
              {transforming ? t("flow.transforming") : t("flow.runCommand")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!scratchText.trim()}
              onClick={handleSaveAsNote}
              title={t("flow.saveAsNote")}
            >
              <NotebookPen size={13} />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!scratchText.trim()}
              onClick={handleCopy}
              title={t("common.copy")}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
};

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const isLinux = type() === "linux";
  // Only for Chinese speakers, or anyone who already picked a script.
  const speaksChinese =
    (getSetting("spoken_languages") ?? []).some(isChinese) ||
    (getSetting("chinese_script") ?? "as_transcribed") !== "as_transcribed";
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <FlowStudioCard />
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutActivationSetting descriptionMode="tooltip" grouped={true} />
        {/* Cancel shortcut remains hidden on Linux because of dynamic shortcut instability. */}
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
