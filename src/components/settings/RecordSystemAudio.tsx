import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface RecordSystemAudioProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Whether meeting/call audio is recorded alongside the microphone in Notes. */
export const RecordSystemAudio: React.FC<RecordSystemAudioProps> = React.memo(
  ({ descriptionMode = "inline", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    return (
      <ToggleSwitch
        checked={getSetting("record_system_audio") ?? true}
        onChange={(enabled) => updateSetting("record_system_audio", enabled)}
        isUpdating={isUpdating("record_system_audio")}
        label={t("settings.sound.recordSystemAudio.label")}
        description={t("settings.sound.recordSystemAudio.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
RecordSystemAudio.displayName = "RecordSystemAudio";
