import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ChannelSelector } from "../ChannelSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { ShortcutActivationSetting } from "../ShortcutActivation";
import { AudioFeedback } from "../AudioFeedback";
import { AutostartToggle } from "../AutostartToggle";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";
import { PreferredLanguages } from "../PreferredLanguages";
import { ChineseScriptSetting } from "../ChineseScript";
import { isChinese } from "@/lib/utils/languageSuggestions";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting, updateSetting, isUpdating } =
    useSettings();
  const isLinux = type() === "linux";
  const [showMore, setShowMore] = useState(false);
  // The cleanup and command shortcuts do nothing without an AI provider.
  const aiEnabled = getSetting("post_process_enabled") ?? false;
  const speaksChinese =
    (getSetting("spoken_languages") ?? []).some(isChinese) ||
    (getSetting("chinese_script") ?? "as_transcribed") !== "as_transcribed";

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      {/* The few things most people change. */}
      <SettingsGroup title={t("settings.general.essentials")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutActivationSetting grouped={true} />
        <MicrophoneSelector grouped={true} />
        {!getSetting("selected_microphone") && (
          <ToggleSwitch
            grouped
            checked={getSetting("prefer_builtin_mic") ?? true}
            onChange={(on) => updateSetting("prefer_builtin_mic", on)}
            isUpdating={isUpdating("prefer_builtin_mic")}
            label={t("settings.sound.preferBuiltinMic.label")}
            description={t("settings.sound.preferBuiltinMic.description")}
          />
        )}
        <PreferredLanguages grouped={true} />
        <AudioFeedback grouped={true} />
        <AutostartToggle grouped={true} />
        <ToggleSwitch
          grouped
          checked={getSetting("floating_bar") ?? true}
          onChange={(on) => updateSetting("floating_bar", on)}
          isUpdating={isUpdating("floating_bar")}
          label={t("settings.general.floatingBar.label")}
          description={t("settings.general.floatingBar.description")}
        />
      </SettingsGroup>

      <button
        type="button"
        onClick={() => setShowMore(!showMore)}
        aria-expanded={showMore}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-start shadow-xs transition-colors hover:bg-accent/50 cursor-pointer"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {showMore
              ? t("settings.general.fewerOptions")
              : t("settings.general.moreOptions")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("settings.general.moreOptionsHint")}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${showMore ? "rotate-180" : ""}`}
        />
      </button>

      {showMore && (
        <div className="space-y-6">
          <SettingsGroup title={t("settings.general.otherShortcuts")}>
            <ShortcutInput shortcutId="voice_note" grouped={true} />
            <ShortcutInput shortcutId="paste_last_transcript" grouped={true} />
            <ShortcutInput shortcutId="copy_last_transcript" grouped={true} />
            {aiEnabled && (
              <>
                <ShortcutInput
                  shortcutId="transcribe_with_post_process"
                  grouped={true}
                />
                <ShortcutInput shortcutId="command_mode" grouped={true} />
              </>
            )}
            {!isLinux && <ShortcutInput shortcutId="cancel" grouped={true} />}
          </SettingsGroup>

          <ModelSettingsCard />

          {speaksChinese && (
            <SettingsGroup title={t("settings.languages.title")}>
              <ChineseScriptSetting grouped={true} />
            </SettingsGroup>
          )}

          <SettingsGroup title={t("settings.sound.title")}>
            <ChannelSelector grouped={true} />
            <MuteWhileRecording grouped={true} />
            <OutputDeviceSelector
              grouped={true}
              disabled={!audioFeedbackEnabled}
            />
            <VolumeSlider disabled={!audioFeedbackEnabled} />
          </SettingsGroup>
        </div>
      )}
    </div>
  );
};
