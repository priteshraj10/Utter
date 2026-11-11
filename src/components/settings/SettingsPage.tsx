import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  NAVIGATE_EVENT,
  takePendingSettingsTab,
  type SettingsTab,
} from "@/lib/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AboutSettings } from "./about/AboutSettings";
import { AdvancedSettings } from "./advanced/AdvancedSettings";
import { GeneralSettings } from "./general/GeneralSettings";

const TABS: SettingsTab[] = ["general", "advanced", "about"];

/** All configuration in one place: the essentials first, the rest in tabs. */
export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>(
    () => takePendingSettingsTab() ?? "general",
  );

  // Already on Settings when another page asks for a tab.
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ settingsTab: SettingsTab | null }>)
        .detail;
      if (detail?.settingsTab) {
        takePendingSettingsTab();
        setTab(detail.settingsTab);
      }
    };
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, []);

  return (
    <div className="max-w-3xl w-full mx-auto">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as SettingsTab)}
        className="space-y-5"
      >
        <TabsList>
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`settings.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedSettings />
        </TabsContent>
        <TabsContent value="about">
          <AboutSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};
