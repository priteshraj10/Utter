import React from "react";
import { useTranslation } from "react-i18next";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";
import { LogLevelSelector } from "./LogLevelSelector";
import { LiveLogViewer } from "./LiveLogViewer";
import { PasteDelay } from "./PasteDelay";
import { HoldThreshold } from "./HoldThreshold";
import { ReliablePasteToggle } from "./ReliablePaste";
import { RecordingBuffer } from "./RecordingBuffer";
import { LanguageDetectionWindow } from "./LanguageDetectionWindow";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { SoundPicker } from "../SoundPicker";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { WhatsNewPreview } from "./WhatsNewPreview";
import { KeyboardDiagnostic } from "./KeyboardDiagnostic";
import { DebugRun, OnboardingPreview } from "./OnboardingPreview";
import type { OnboardingStep } from "../../onboarding/onboardingStore";

interface DebugSettingsProps {
  onPreviewOnboarding: (step: OnboardingStep) => void;
  onRunOnboarding: () => void;
  onRunModelMigration: () => void;
}

export const DebugSettings: React.FC<DebugSettingsProps> = ({
  onPreviewOnboarding,
  onRunOnboarding,
  onRunModelMigration,
}) => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.debug.title")}>
        <LogLevelSelector grouped={true} />
        <WhatsNewPreview grouped={true} />
        <OnboardingPreview onPreview={onPreviewOnboarding} grouped={true} />
        <DebugRun run="onboardingRun" onRun={onRunOnboarding} grouped={true} />
        <DebugRun
          run="modelMigration"
          onRun={onRunModelMigration}
          grouped={true}
        />
        <UpdateChecksToggle grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <WordCorrectionThreshold grouped={true} />
        <PasteDelay grouped={true} />
        <PasteDelay
          grouped={true}
          settingKey="paste_delay_after_ms"
          labelKey="settings.debug.pasteDelayAfter.title"
          descriptionKey="settings.debug.pasteDelayAfter.description"
        />
        <ReliablePasteToggle grouped={true} />
        <HoldThreshold grouped={true} />
        <RecordingBuffer grouped={true} />
        <LanguageDetectionWindow grouped={true} />
        <AlwaysOnMicrophone grouped={true} />
        <ClamshellMicrophoneSelector grouped={true} />
        <KeyboardDiagnostic />
        <LiveLogViewer grouped={true} />
      </SettingsGroup>
    </div>
  );
};
