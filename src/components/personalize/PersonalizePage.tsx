import React from "react";
import { useTranslation } from "react-i18next";
import { CustomWords } from "../settings/CustomWords";
import { SettingsGroup } from "../ui/SettingsGroup";
import { AppStylesEditor } from "./AppStylesEditor";
import { SmartFeatures } from "./SmartFeatures";
import { SnippetsEditor } from "./SnippetsEditor";

const Page: React.FC<{ intro: string; children: React.ReactNode }> = ({
  intro,
  children,
}) => (
  <div className="max-w-3xl w-full mx-auto space-y-5">
    <p className="px-1 text-sm text-muted-foreground">{intro}</p>
    {children}
  </div>
);

/** Words Utter should get right. */
export const DictionaryPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Page intro={t("personalize.intro.dictionary")}>
      <SettingsGroup>
        <CustomWords grouped />
      </SettingsGroup>
    </Page>
  );
};

/** Short phrases that expand into longer text. */
export const SnippetsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Page intro={t("personalize.intro.snippets")}>
      <SnippetsEditor />
    </Page>
  );
};

/** How Utter writes: per-app styles, the smart features, and the AI engine. */
export const StylePage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Page intro={t("personalize.intro.styles")}>
      <AppStylesEditor />
      <div className="pt-2">
        <SmartFeatures />
      </div>
    </Page>
  );
};
