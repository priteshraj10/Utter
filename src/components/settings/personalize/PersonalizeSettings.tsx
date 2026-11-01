import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Compass, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { commands, type AppStyle, type Snippet } from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Input } from "../../ui/Input";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { ShortcutInput } from "../ShortcutInput";
import { PostProcessingToggle } from "../PostProcessingToggle";
import { FillerWordRemoval } from "../FillerWordRemoval";
import { CustomWords } from "../CustomWords";

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Common apps offered as suggestions; any name or bundle id works. */
const APP_SUGGESTIONS = [
  "Slack",
  "Mail",
  "Messages",
  "Notes",
  "Notion",
  "WhatsApp",
  "Google Chrome",
  "Safari",
  "Microsoft Outlook",
  "Microsoft Word",
  "Visual Studio Code",
  "Cursor",
  "Terminal",
];

const RECOMMENDED_APP_STYLES: Array<{ app: string; prompt_id: string }> = [
  { app: "Slack", prompt_id: "style_casual" },
  { app: "Messages", prompt_id: "style_very_casual" },
  { app: "WhatsApp", prompt_id: "style_very_casual" },
  { app: "Mail", prompt_id: "style_email" },
  { app: "Microsoft Outlook", prompt_id: "style_email" },
  { app: "Notion", prompt_id: "style_bullets" },
  { app: "Notes", prompt_id: "style_bullets" },
  { app: "Visual Studio Code", prompt_id: "style_code" },
  { app: "Cursor", prompt_id: "style_code" },
  { app: "Terminal", prompt_id: "style_code" },
];

const STARTER_SNIPPETS: Array<{ trigger: string; expansion: string }> = [
  {
    trigger: "daily standup",
    expansion:
      "Standup ({{date}}):\n- Yesterday: \n- Today: \n- Blockers: None",
  },
  {
    trigger: "my calendar link",
    expansion: "https://cal.com/me/30min",
  },
  {
    trigger: "standard sign off",
    expansion: "Best regards,\nSent via Utter on {{day}}",
  },
  {
    trigger: "bug report template",
    expansion:
      "### Bug Report ({{datetime}})\n**Steps to Reproduce:**\n1. \n\n**Expected:**\n\n**Actual:**",
  },
];

const DICTIONARY_PACKS: Array<{
  id: string;
  labelKey: string;
  words: string[];
}> = [
  {
    id: "engineering",
    labelKey: "settings.personalize.dictionary.packEngineering",
    words: [
      "TypeScript",
      "PostgreSQL",
      "Kubernetes",
      "GraphQL",
      "WebSockets",
      "OAuth",
      "Tailwind",
      "Supabase",
      "PyTorch",
      "GGUF",
      "Vercel",
      "Docker",
    ],
  },
  {
    id: "product",
    labelKey: "settings.personalize.dictionary.packProduct",
    words: [
      "Figma",
      "Linear",
      "Notion",
      "Roadmap",
      "Wireframe",
      "Onboarding",
      "OKRs",
      "KPIs",
      "Sprint",
      "Retrospective",
    ],
  },
  {
    id: "business",
    labelKey: "settings.personalize.dictionary.packBusiness",
    words: [
      "ARR",
      "MRR",
      "EBITDA",
      "Runway",
      "CapEx",
      "OpEx",
      "SaaS",
      "B2B",
      "Deliverables",
      "Stakeholders",
    ],
  },
];

const AutoCleanup: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const aiEnabled = getSetting("post_process_enabled") ?? false;
  return (
    <ToggleSwitch
      checked={getSetting("auto_cleanup") ?? false}
      onChange={(enabled) => updateSetting("auto_cleanup", enabled)}
      isUpdating={isUpdating("auto_cleanup")}
      disabled={!aiEnabled}
      label={t("settings.personalize.autoCleanup.title")}
      description={t(
        aiEnabled
          ? "settings.personalize.autoCleanup.description"
          : "settings.personalize.autoCleanup.needsAi",
      )}
      descriptionMode="inline"
      grouped
    />
  );
};

const WhisperModeToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("whisper_mode") ?? false}
      onChange={(enabled) => updateSetting("whisper_mode", enabled)}
      isUpdating={isUpdating("whisper_mode")}
      label={t("settings.personalize.whisperMode.title")}
      description={t("settings.personalize.whisperMode.description")}
      descriptionMode="inline"
      grouped
    />
  );
};

const AppStyles: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const styles = getSetting("app_styles") ?? [];
  const prompts = getSetting("post_process_prompts") ?? [];
  const promptOptions = prompts.map((p) => ({ value: p.id, label: p.name }));
  const [app, setApp] = useState("");
  const [promptId, setPromptId] = useState<string | null>(
    prompts.find((p) => p.id === "style_casual")?.id ?? null,
  );

  const save = (next: AppStyle[]) => updateSetting("app_styles", next);
  const add = () => {
    const name = app.trim();
    if (!name || !promptId) return;
    save([
      ...styles.filter((s) => s.app.toLowerCase() !== name.toLowerCase()),
      { id: newId(), app: name, prompt_id: promptId },
    ]);
    setApp("");
  };

  const applyRecommended = () => {
    const existing = new Set(styles.map((s) => s.app.toLowerCase()));
    const additions = RECOMMENDED_APP_STYLES.filter(
      (r) => !existing.has(r.app.toLowerCase()),
    ).map((r) => ({ id: newId(), ...r }));
    if (additions.length === 0) {
      toast.info(t("settings.personalize.appStyles.presetsAlreadyAdded"));
      return;
    }
    save([...styles, ...additions]);
    toast.success(
      t("settings.personalize.appStyles.presetsAdded", {
        count: additions.length,
      }),
    );
  };

  const detectCurrentApp = async () => {
    const front = await commands.getFrontmostApp();
    if (front) setApp(front);
  };

  return (
    <SettingsGroup
      title={t("settings.personalize.appStyles.title")}
      description={t("settings.personalize.appStyles.description")}
    >
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={applyRecommended}
            className="flex items-center gap-1.5"
          >
            <Sparkles size={13} />
            {t("settings.personalize.appStyles.addRecommended")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={detectCurrentApp}
            className="flex items-center gap-1.5"
          >
            <Compass size={13} />
            {t("settings.personalize.appStyles.detectApp")}
          </Button>
        </div>
        {styles.length === 0 && (
          <p className="text-sm text-ink-3">
            {t("settings.personalize.appStyles.empty")}
          </p>
        )}
        {styles.map((style) => (
          <div key={style.id} className="flex items-center gap-2">
            <span className="w-44 shrink-0 truncate text-sm font-medium">
              {style.app}
            </span>
            <Select
              className="flex-1"
              value={style.prompt_id}
              options={promptOptions}
              onChange={(value) =>
                value &&
                save(
                  styles.map((s) =>
                    s.id === style.id ? { ...s, prompt_id: value } : s,
                  ),
                )
              }
            />
            <Button
              variant="secondary"
              size="sm"
              title={t("settings.personalize.remove")}
              onClick={() => save(styles.filter((s) => s.id !== style.id))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2 border-t border-line">
          <Input
            className="w-44 shrink-0"
            list="utter-app-suggestions"
            value={app}
            onChange={(e) => setApp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={t("settings.personalize.appStyles.appPlaceholder")}
          />
          <datalist id="utter-app-suggestions">
            {APP_SUGGESTIONS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Select
            className="flex-1"
            value={promptId}
            options={promptOptions}
            onChange={setPromptId}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={add}
            disabled={!app.trim() || !promptId}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
};

const Snippets: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const snippets = getSetting("snippets") ?? [];
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");

  const save = (next: Snippet[]) => updateSetting("snippets", next);
  const add = () => {
    if (!trigger.trim() || !expansion) return;
    save([
      ...snippets,
      { id: newId(), trigger: trigger.trim(), expansion: expansion },
    ]);
    setTrigger("");
    setExpansion("");
  };

  const addStarterSnippets = () => {
    const existing = new Set(snippets.map((s) => s.trigger.toLowerCase()));
    const additions = STARTER_SNIPPETS.filter(
      (s) => !existing.has(s.trigger.toLowerCase()),
    ).map((s) => ({ id: newId(), ...s }));
    if (additions.length === 0) {
      toast.info(t("settings.personalize.snippets.startersAlreadyAdded"));
      return;
    }
    save([...snippets, ...additions]);
    toast.success(
      t("settings.personalize.snippets.startersAdded", {
        count: additions.length,
      }),
    );
  };

  return (
    <SettingsGroup
      title={t("settings.personalize.snippets.title")}
      description={t("settings.personalize.snippets.description")}
    >
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <p className="text-xs text-ink-3">
            {t("settings.personalize.snippets.variablesHint")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={addStarterSnippets}
            className="flex items-center gap-1.5"
          >
            <Sparkles size={13} />
            {t("settings.personalize.snippets.addStarters")}
          </Button>
        </div>
        {snippets.map((snippet) => (
          <div key={snippet.id} className="flex items-start gap-2">
            <span className="w-44 shrink-0 truncate text-sm font-medium pt-1">
              “{snippet.trigger}”
            </span>
            <p className="flex-1 text-sm text-ink-2 whitespace-pre-wrap break-words pt-1">
              {snippet.expansion}
            </p>
            <Button
              variant="secondary"
              size="sm"
              title={t("settings.personalize.remove")}
              onClick={() => save(snippets.filter((s) => s.id !== snippet.id))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <div className="flex items-start gap-2 pt-2 border-t border-line">
          <Input
            className="w-44 shrink-0"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder={t("settings.personalize.snippets.triggerPlaceholder")}
          />
          <Textarea
            variant="compact"
            className="flex-1 min-h-[40px]"
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            placeholder={t(
              "settings.personalize.snippets.expansionPlaceholder",
            )}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={add}
            disabled={!trigger.trim() || !expansion}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
};

const DictionaryPacks: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const customWords = getSetting("custom_words") ?? [];

  const addPack = (words: string[]) => {
    const existing = new Set(customWords.map((w) => w.toLowerCase()));
    const fresh = words.filter((w) => !existing.has(w.toLowerCase()));
    if (fresh.length === 0) {
      toast.info(t("settings.personalize.dictionary.packAlreadyAdded"));
      return;
    }
    updateSetting("custom_words", [...customWords, ...fresh]);
    toast.success(
      t("settings.personalize.dictionary.packAdded", { count: fresh.length }),
    );
  };

  return (
    <div className="px-4 py-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-ink-3 flex items-center gap-1.5">
        <BookOpen size={13} className="text-logo-primary" />
        {t("settings.personalize.dictionary.packsLabel")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {DICTIONARY_PACKS.map((pack) => (
          <Button
            key={pack.id}
            variant="secondary"
            size="sm"
            onClick={() => addPack(pack.words)}
          >
            + {t(pack.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
};

export const PersonalizeSettings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.personalize.ai.title")}>
        <PostProcessingToggle descriptionMode="tooltip" grouped={true} />
        <AutoCleanup />
        <WhisperModeToggle />
        <FillerWordRemoval descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
      <SettingsGroup title={t("settings.personalize.shortcuts.title")}>
        <ShortcutInput shortcutId="command_mode" grouped={true} />
        <ShortcutInput shortcutId="voice_note" grouped={true} />
      </SettingsGroup>
      <AppStyles />
      <Snippets />
      <SettingsGroup title={t("settings.personalize.dictionary.title")}>
        <CustomWords descriptionMode="tooltip" grouped />
        <DictionaryPacks />
      </SettingsGroup>
    </div>
  );
};
