import React from "react";
import { useTranslation } from "react-i18next";
import { CustomWords } from "../settings/CustomWords";
import { SettingsGroup } from "../ui/SettingsGroup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AppStylesEditor } from "./AppStylesEditor";
import { SmartFeatures } from "./SmartFeatures";
import { SnippetsEditor } from "./SnippetsEditor";

const TABS = ["smart", "dictionary", "snippets", "styles"] as const;

/** Everything that makes dictation sound like you. */
export const PersonalizePage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto">
      <Tabs defaultValue="smart" className="space-y-5">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`personalize.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-4">
            <p className="px-1 text-sm text-muted-foreground">
              {t(`personalize.intro.${tab}`)}
            </p>
            {tab === "smart" && <SmartFeatures />}
            {tab === "dictionary" && (
              <SettingsGroup>
                <CustomWords grouped />
              </SettingsGroup>
            )}
            {tab === "snippets" && <SnippetsEditor />}
            {tab === "styles" && <AppStylesEditor />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};
