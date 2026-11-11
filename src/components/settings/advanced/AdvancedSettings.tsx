import React from "react";
import { useTranslation } from "react-i18next";
import { ShowOverlay } from "../ShowOverlay";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { StartHidden } from "../StartHidden";
import { AutostartToggle } from "../AutostartToggle";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { PasteMethodSetting } from "../PasteMethod";
import { TypingToolSetting } from "../TypingTool";
import { ClipboardHandlingSetting } from "../ClipboardHandling";
import { AutoSubmit } from "../AutoSubmit";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { HistoryLimit } from "../HistoryLimit";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { useSettings } from "../../../hooks/useSettings";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";
import { VoiceActivityDetection } from "../VoiceActivityDetection";
import { LongFormChunking } from "../LongFormChunking";
import { LanguageDetection } from "../LanguageDetection";
import { AccelerationSelector } from "../AccelerationSelector";
import { LazyStreamClose } from "../LazyStreamClose";
import { VadBackendSelector } from "../VadBackendSelector";
import { PostProcessingSettingsApi } from "../PostProcessingSettingsApi";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const experimentalEnabled = getSetting("experimental_enabled") || false;

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <StartHidden grouped={true} />
        <AutostartToggle grouped={true} />
        <ShowTrayIcon grouped={true} />
        <ShowOverlay grouped={true} />
        <ModelUnloadTimeoutSetting grouped={true} />
        <ExperimentalToggle grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.output")}>
        <PasteMethodSetting grouped={true} />
        <TypingToolSetting grouped={true} />
        <ClipboardHandlingSetting grouped={true} />
        <AutoSubmit grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.transcription")}>
        <VoiceActivityDetection grouped={true} />
        <LongFormChunking grouped={true} />
        <AppendTrailingSpace grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("sidebar.postProcessing")}>
        <PostProcessingSettingsApi />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.history")}>
        <HistoryLimit grouped={true} />
        <RecordingRetentionPeriodSelector grouped={true} />
      </SettingsGroup>

      {experimentalEnabled && (
        <SettingsGroup title={t("settings.advanced.groups.experimental")}>
          <KeyboardImplementationSelector grouped={true} />
          <AccelerationSelector grouped={true} />
          <LazyStreamClose grouped={true} />
          <VadBackendSelector grouped={true} />
          <LanguageDetection grouped={true} />
        </SettingsGroup>
      )}
    </div>
  );
};
