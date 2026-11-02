import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  Compass,
  Eye,
  MessageSquare,
  Mail,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
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

export type PersonalizeTab =
  | "all"
  | "style"
  | "dictionary"
  | "snippets"
  | "transforms";

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

type StyleCategory = "personal" | "work" | "email" | "other";

const STYLE_CATEGORY_APPS: Record<StyleCategory, string[]> = {
  personal: ["Messages", "WhatsApp", "Telegram", "Signal", "Discord"],
  work: ["Slack", "Microsoft Teams", "Linear", "Notion"],
  email: ["Mail", "Microsoft Outlook", "Superhuman", "Spark"],
  other: ["Visual Studio Code", "Cursor", "Terminal", "Notes"],
};

const STYLE_PRESET_CARDS = [
  {
    id: "style_formal",
    titleKey: "settings.personalize.styleCards.formalTitle",
    subtitleKey: "settings.personalize.styleCards.formalSubtitle",
    chatPreview: "Hey Sarah, are you free for a quick call at 3:00 PM today?",
    emailPreview:
      "Hi Sarah,\n\nLet me know if 3:00 PM works for a quick sync today.\n\nBest,\nAlex",
  },
  {
    id: "style_casual",
    titleKey: "settings.personalize.styleCards.casualTitle",
    subtitleKey: "settings.personalize.styleCards.casualSubtitle",
    chatPreview: "Hey Sarah, free for a quick call at 3pm today?",
    emailPreview:
      "Hey Sarah,\n\nLet me know if 3pm works for a quick sync today!\n\nThanks,\nAlex",
  },
  {
    id: "style_very_casual",
    titleKey: "settings.personalize.styleCards.veryCasualTitle",
    subtitleKey: "settings.personalize.styleCards.veryCasualSubtitle",
    chatPreview: "hey sarah free for a quick call at 3pm today?",
    emailPreview: "hey sarah — let me know if 3pm works for a quick sync today",
  },
  {
    id: "style_excited",
    titleKey: "settings.personalize.styleCards.excitedTitle",
    subtitleKey: "settings.personalize.styleCards.excitedSubtitle",
    chatPreview: "Hey Sarah! Are you free for a quick call at 3pm today?!",
    emailPreview:
      "Hi Sarah!\n\nWould love to hop on a quick sync at 3pm today if you're free!\n\nBest,\nAlex",
  },
] as const;

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

const VoiceCommandsToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("voice_commands") ?? true}
      onChange={(enabled) => updateSetting("voice_commands", enabled)}
      isUpdating={isUpdating("voice_commands")}
      label={t("settings.personalize.voiceCommands.title")}
      description={t("settings.personalize.voiceCommands.description")}
      descriptionMode="inline"
      grouped
    />
  );
};

const ContextAwarenessToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("context_awareness") ?? true}
      onChange={(enabled) => updateSetting("context_awareness", enabled)}
      isUpdating={isUpdating("context_awareness")}
      label={t("settings.personalize.contextAwareness.title")}
      description={t("settings.personalize.contextAwareness.description")}
      descriptionMode="inline"
      grouped
    />
  );
};

/** Wispr Flow-style 4-category visual tone & formatting selector */
const WisprStyleCardsSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const [category, setCategory] = useState<StyleCategory>("personal");
  const styles = getSetting("app_styles") ?? [];
  const defaultPromptId =
    getSetting("post_process_selected_prompt_id") ?? "style_casual";

  const categoryApps = STYLE_CATEGORY_APPS[category];
  const activeStyleForCategory =
    styles.find((s) =>
      categoryApps.some((a) => a.toLowerCase() === s.app.toLowerCase()),
    )?.prompt_id ?? defaultPromptId;

  const selectPresetForCategory = (presetId: string) => {
    const filtered = styles.filter(
      (s) => !categoryApps.some((a) => a.toLowerCase() === s.app.toLowerCase()),
    );
    const additions: AppStyle[] = categoryApps.map((app) => ({
      id: newId(),
      app,
      prompt_id: presetId,
    }));
    updateSetting("app_styles", [...filtered, ...additions]);
    if (category === "other") {
      updateSetting("post_process_selected_prompt_id", presetId);
    }
    toast.success(t("settings.personalize.styleCards.appliedToast"));
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className="text-2xl text-text"
            style={{
              fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
            }}
          >
            {t("settings.personalize.styleCards.heading")}
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {t("settings.personalize.styleCards.subheading")}
          </p>
        </div>

        {/* Category Tabs: Personal messages | Work messages | Email | Other */}
        <div className="flex rounded-xl bg-sidebar p-1 border border-line">
          {(
            [
              ["personal", t("settings.personalize.styleCards.tabPersonal")],
              ["work", t("settings.personalize.styleCards.tabWork")],
              ["email", t("settings.personalize.styleCards.tabEmail")],
              ["other", t("settings.personalize.styleCards.tabOther")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategory(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                category === id
                  ? "bg-surface text-text shadow-xs border border-line"
                  : "text-ink-3 hover:text-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        <span>{t("settings.personalize.styleCards.appliesToApps")}</span>
        {categoryApps.map((app) => (
          <span
            key={app}
            className="px-2 py-0.5 rounded-md bg-sidebar border border-line text-ink-2 font-medium"
          >
            {app}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {STYLE_PRESET_CARDS.map((card) => {
          const isSelected = activeStyleForCategory === card.id;
          const isEmail = category === "email";
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => selectPresetForCategory(card.id)}
              className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                isSelected
                  ? "border-logo-primary bg-logo-primary/8 shadow-xs"
                  : "border-line bg-background hover:border-line-strong"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span
                    className="text-xl font-medium text-text block"
                    style={{
                      fontFamily:
                        'var(--font-serif), "EB Garamond", Georgia, serif',
                    }}
                  >
                    {t(card.titleKey)}
                  </span>
                  <span className="text-xs text-ink-3 mt-0.5 block">
                    {t(card.subtitleKey)}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    isSelected
                      ? "bg-logo-primary text-white"
                      : "bg-sidebar text-ink-3"
                  }`}
                >
                  {isSelected
                    ? t("settings.personalize.styleCards.active")
                    : t("settings.personalize.styleCards.apply")}
                </span>
              </div>

              <div className="rounded-lg bg-sidebar/80 border border-line/80 p-3 text-xs text-ink-1 whitespace-pre-wrap leading-relaxed flex items-start gap-2">
                {isEmail ? (
                  <Mail size={13} className="text-ink-3 shrink-0 mt-0.5" />
                ) : (
                  <MessageSquare
                    size={13}
                    className="text-logo-primary shrink-0 mt-0.5"
                  />
                )}
                <span>{isEmail ? card.emailPreview : card.chatPreview}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
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
  const [search, setSearch] = useState("");

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

  const filteredSnippets = snippets.filter(
    (s) =>
      !search.trim() ||
      s.trigger.toLowerCase().includes(search.toLowerCase()) ||
      s.expansion.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className="text-2xl text-text"
            style={{
              fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
            }}
          >
            {t("settings.personalize.snippets.title")}
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {t("settings.personalize.snippets.description")}
          </p>
        </div>
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

      <div className="flex items-center justify-between gap-2">
        <label className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line bg-background focus-within:border-logo-primary">
          <Search size={14} className="text-ink-3 shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("settings.personalize.snippets.triggerPlaceholder")}
            className="w-full bg-transparent text-xs outline-none"
          />
        </label>
        <span className="text-[11px] text-ink-3">
          {t("settings.personalize.snippets.variablesHint")}
        </span>
      </div>

      <div className="space-y-2">
        {filteredSnippets.map((snippet) => (
          <div
            key={snippet.id}
            className="flex items-start gap-3 p-3 rounded-xl border border-line bg-background"
          >
            <span className="px-2.5 py-1 rounded-lg bg-sidebar border border-line text-xs font-medium text-text shrink-0">
              “{snippet.trigger}”
            </span>
            <ArrowRight size={14} className="text-ink-3 shrink-0 mt-1.5" />
            <p className="flex-1 text-xs text-ink-2 whitespace-pre-wrap break-words pt-1">
              {snippet.expansion}
            </p>
            <Button
              variant="secondary"
              size="sm"
              title={t("settings.personalize.remove")}
              onClick={() => save(snippets.filter((s) => s.id !== snippet.id))}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 pt-3 border-t border-line">
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
          placeholder={t("settings.personalize.snippets.expansionPlaceholder")}
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
  );
};

/** Wispr Flow Dictionary view with vocabulary words + misspelling replacement rules */
const DictionaryStudio: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const customWords = getSetting("custom_words") ?? [];
  const [newWord, setNewWord] = useState("");
  const [misspelling, setMisspelling] = useState("");
  const [replacement, setReplacement] = useState("");
  const [search, setSearch] = useState("");

  const addSingleWord = () => {
    const cleaned = newWord.trim();
    if (!cleaned) return;
    if (customWords.includes(cleaned)) {
      toast.error(
        t("settings.advanced.customWords.duplicate", { word: cleaned }),
      );
      return;
    }
    updateSetting("custom_words", [...customWords, cleaned]);
    setNewWord("");
  };

  const addReplacementRule = () => {
    const from = misspelling.trim();
    const to = replacement.trim();
    if (!from || !to) return;
    const rule = `${from} -> ${to}`;
    if (customWords.includes(rule)) return;
    updateSetting("custom_words", [...customWords, rule]);
    setMisspelling("");
    setReplacement("");
  };

  const removeWord = (target: string) => {
    updateSetting(
      "custom_words",
      customWords.filter((w) => w !== target),
    );
  };

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

  const filteredWords = customWords.filter(
    (w) => !search.trim() || w.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className="text-2xl text-text"
            style={{
              fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
            }}
          >
            {t("settings.personalize.dictionary.title")}
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {t("settings.personalize.dictionary.subtitle")}
          </p>
        </div>
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

      {/* Add vocabulary word or replacement rule */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-background p-3.5 space-y-2">
          <span className="text-xs font-medium text-ink-2 block">
            {t("settings.personalize.dictionary.addWordLabel")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSingleWord()}
              placeholder={t("settings.advanced.customWords.placeholder")}
              variant="compact"
              className="flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={addSingleWord}
              disabled={!newWord.trim() || isUpdating("custom_words")}
            >
              {t("settings.advanced.customWords.add")}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-background p-3.5 space-y-2">
          <span className="text-xs font-medium text-ink-2 block">
            {t("settings.personalize.dictionary.addRuleLabel")}
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              type="text"
              value={misspelling}
              onChange={(e) => setMisspelling(e.target.value)}
              placeholder={t(
                "settings.personalize.dictionary.misspellingPlaceholder",
              )}
              variant="compact"
              className="flex-1"
            />
            <ArrowRight size={13} className="text-ink-3 shrink-0" />
            <Input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReplacementRule()}
              placeholder={t(
                "settings.personalize.dictionary.replacementPlaceholder",
              )}
              variant="compact"
              className="flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={addReplacementRule}
              disabled={
                !misspelling.trim() ||
                !replacement.trim() ||
                isUpdating("custom_words")
              }
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>
      </div>

      {/* Search & Word Table */}
      <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line bg-background focus-within:border-logo-primary">
        <Search size={14} className="text-ink-3 shrink-0" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.personalize.dictionary.searchPlaceholder")}
          className="w-full bg-transparent text-xs outline-none"
        />
      </label>

      {filteredWords.length === 0 ? (
        <p className="text-xs text-ink-3 text-center py-4">
          {t("settings.personalize.dictionary.empty")}
        </p>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line bg-background overflow-hidden">
          {filteredWords.map((entry) => {
            const parts = entry.includes("->")
              ? entry.split("->")
              : entry.includes("=>")
                ? entry.split("=>")
                : null;
            return (
              <div
                key={entry}
                className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs hover:bg-sidebar/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles size={12} className="text-logo-primary shrink-0" />
                  {parts ? (
                    <div className="flex items-center gap-2 truncate">
                      <span className="line-through text-ink-3">
                        {parts[0].trim()}
                      </span>
                      <ArrowRight size={12} className="text-ink-3 shrink-0" />
                      <span className="font-semibold text-text">
                        {parts[1].trim()}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-logo-primary/12 text-logo-primary text-[10px]">
                        {t("settings.personalize.dictionary.replacementBadge")}
                      </span>
                    </div>
                  ) : (
                    <span className="font-medium text-text truncate">
                      {entry}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeWord(entry)}
                  className="text-ink-3 hover:text-error p-1 rounded cursor-pointer"
                  title={t("settings.personalize.remove")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Wispr Flow Transforms section (Polish, Prompt Engineer, Custom Transforms) */
const TransformsStudio: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const prompts = getSetting("post_process_prompts") ?? [];
  const selectedId =
    getSetting("post_process_selected_prompt_id") ??
    "default_improve_transcriptions";
  const autoCleanup = getSetting("auto_cleanup") ?? false;

  const builtInTransforms = [
    {
      id: "default_improve_transcriptions",
      titleKey: "settings.personalize.transforms.polishTitle",
      descKey: "settings.personalize.transforms.polishDesc",
    },
    {
      id: "style_prompt_engineer",
      titleKey: "settings.personalize.transforms.promptEngineerTitle",
      descKey: "settings.personalize.transforms.promptEngineerDesc",
    },
    {
      id: "style_concise",
      titleKey: "settings.personalize.transforms.conciseTitle",
      descKey: "settings.personalize.transforms.conciseDesc",
    },
    {
      id: "style_code",
      titleKey: "settings.personalize.transforms.codeTitle",
      descKey: "settings.personalize.transforms.codeDesc",
    },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className="text-2xl text-text"
            style={{
              fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
            }}
          >
            {t("settings.personalize.transforms.title")}
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {t("settings.personalize.transforms.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting("auto_cleanup", !autoCleanup)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer transition-colors flex items-center gap-1.5 ${
            autoCleanup
              ? "bg-logo-primary text-white border-logo-primary"
              : "bg-background text-ink-2 border-line"
          }`}
        >
          <Wand2 size={12} />
          {t("settings.personalize.transforms.autoApplyAfterDictation")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {builtInTransforms.map((tr) => {
          const active = selectedId === tr.id;
          return (
            <button
              key={tr.id}
              type="button"
              onClick={() =>
                updateSetting("post_process_selected_prompt_id", tr.id)
              }
              className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                active
                  ? "border-logo-primary bg-logo-primary/8"
                  : "border-line bg-background hover:border-line-strong"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text flex items-center gap-1.5">
                  <Sparkles size={13} className="text-logo-primary" />
                  {t(tr.titleKey)}
                </span>
                {active && (
                  <span className="px-2 py-0.5 rounded-full bg-logo-primary text-white text-[10px] font-medium">
                    {t("settings.personalize.styleCards.active")}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-3 leading-relaxed">
                {t(tr.descKey)}
              </p>
            </button>
          );
        })}
      </div>

      {prompts.length > 0 && (
        <div className="pt-2 border-t border-line flex items-center justify-between gap-3">
          <span className="text-xs text-ink-3">
            {t("settings.personalize.transforms.defaultTransformLabel")}
          </span>
          <Select
            className="w-60"
            value={selectedId}
            options={prompts.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(val) =>
              val && updateSetting("post_process_selected_prompt_id", val)
            }
          />
        </div>
      )}
    </div>
  );
};

export const PersonalizeSettings: React.FC<{
  initialTab?: PersonalizeTab;
}> = ({ initialTab = "all" }) => {
  const { t } = useTranslation();

  if (initialTab === "style") {
    return (
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <WisprStyleCardsSection />
        <AppStyles />
        <SettingsGroup title={t("settings.personalize.ai.title")}>
          <PostProcessingToggle descriptionMode="tooltip" grouped={true} />
          <AutoCleanup />
          <ContextAwarenessToggle />
          <WhisperModeToggle />
          <VoiceCommandsToggle />
          <FillerWordRemoval descriptionMode="tooltip" grouped={true} />
        </SettingsGroup>
      </div>
    );
  }

  if (initialTab === "dictionary") {
    return (
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <DictionaryStudio />
      </div>
    );
  }

  if (initialTab === "snippets") {
    return (
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <Snippets />
      </div>
    );
  }

  if (initialTab === "transforms") {
    return (
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <TransformsStudio />
        <SettingsGroup title={t("settings.personalize.shortcuts.title")}>
          <ShortcutInput shortcutId="command_mode" grouped={true} />
          <ShortcutInput shortcutId="voice_note" grouped={true} />
        </SettingsGroup>
      </div>
    );
  }

  return (
    <div className="max-w-4xl w-full mx-auto space-y-6">
      <WisprStyleCardsSection />
      <TransformsStudio />
      <SettingsGroup title={t("settings.personalize.ai.title")}>
        <PostProcessingToggle descriptionMode="tooltip" grouped={true} />
        <AutoCleanup />
        <ContextAwarenessToggle />
        <WhisperModeToggle />
        <VoiceCommandsToggle />
        <FillerWordRemoval descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
      <SettingsGroup title={t("settings.personalize.shortcuts.title")}>
        <ShortcutInput shortcutId="command_mode" grouped={true} />
        <ShortcutInput shortcutId="voice_note" grouped={true} />
      </SettingsGroup>
      <AppStyles />
      <Snippets />
      <DictionaryStudio />
    </div>
  );
};
