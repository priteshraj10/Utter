import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface KeepAudioProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Whether each dictation's audio is kept after it is typed. */
export const KeepAudio: React.FC<KeepAudioProps> = React.memo(
  ({ descriptionMode = "inline", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    return (
      <ToggleSwitch
        checked={getSetting("keep_audio") ?? true}
        onChange={(enabled) => updateSetting("keep_audio", enabled)}
        isUpdating={isUpdating("keep_audio")}
        label={t("settings.privacy.keepAudio.label")}
        description={t("settings.privacy.keepAudio.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
