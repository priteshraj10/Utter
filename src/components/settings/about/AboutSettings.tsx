import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { ShieldCheck, Sparkles, Cpu } from "lucide-react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { AppDataDirectory } from "../AppDataDirectory";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { ShowWhatsNewOnUpdate } from "../ShowWhatsNewOnUpdate";
import { ThemeSelector } from "../ThemeSelector";
import { LogDirectory } from "../debug";
import UtterMark from "../../icons/UtterMark";

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("1.0.0");
      }
    };

    fetchVersion();
  }, []);

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="rounded-xl border border-line bg-surface-1 p-5 flex items-start gap-4">
        <div className="p-3 rounded-xl bg-logo-primary/15 text-logo-primary shrink-0">
          <UtterMark width={32} height={32} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-ink-1">
              {t("app.name")}
            </h2>
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-line text-ink-2">
              v{version}
            </span>
          </div>
          <p className="text-sm text-ink-2">
            {t("settings.about.acknowledgments.utter.description")}
          </p>
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Cpu size={13} className="text-logo-primary" />
              {t("settings.about.highlights.localEngine")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={13} className="text-logo-primary" />
              {t("settings.about.highlights.contextAi")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-logo-primary" />
              {t("settings.about.highlights.privateByDesign")}
            </span>
          </div>
        </div>
      </div>

      <SettingsGroup title={t("settings.about.title")}>
        <AppLanguageSelector grouped={true} />
        <ThemeSelector grouped={true} />
        <SettingContainer
          title={t("settings.about.version.title")}
          description={t("settings.about.version.description")}
          grouped={true}
        >
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="text-sm font-mono">v{version}</span>
        </SettingContainer>

        <ShowWhatsNewOnUpdate grouped={true} />
        <AppDataDirectory grouped={true} />
        <LogDirectory grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.acknowledgments.title")}>
        <SettingContainer
          title={t("settings.about.acknowledgments.ggml.title")}
          description={t("settings.about.acknowledgments.ggml.description")}
          grouped={true}
          layout="stacked"
        >
          <div className="text-sm text-ink-3">
            {t("settings.about.acknowledgments.ggml.details")}
          </div>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
