import React from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookOpen,
  CheckSquare,
  Cog,
  Cpu,
  FlaskConical,
  History,
  Home,
  Info,
  NotebookPen,
  SlidersHorizontal,
  Sparkles,
  TextQuote,
  Wand2,
} from "lucide-react";
import UtterTextLogo from "./icons/UtterTextLogo";
import { useSettings } from "../hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  PersonalizeSettings,
} from "./settings";
import { NotesPage } from "./notes/NotesPage";
import { StatsPage } from "./stats/StatsPage";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  /** `null` when App renders the section itself (Debug, with its handlers). */
  component: React.ComponentType | null;
  group: "hub" | "workspace" | "system";
  enabled: (settings: any) => boolean;
}

const StyleSection: React.FC = () => <PersonalizeSettings initialTab="style" />;
const DictionarySection: React.FC = () => (
  <PersonalizeSettings initialTab="dictionary" />
);
const SnippetsSection: React.FC = () => (
  <PersonalizeSettings initialTab="snippets" />
);
const TransformsSection: React.FC = () => (
  <PersonalizeSettings initialTab="transforms" />
);
const TasksSection: React.FC = () => <NotesPage initialTab="actions" />;

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: Home,
    component: GeneralSettings,
    group: "hub",
    enabled: () => true,
  },
  style: {
    labelKey: "sidebar.style",
    icon: SlidersHorizontal,
    component: StyleSection,
    group: "hub",
    enabled: () => true,
  },
  dictionary: {
    labelKey: "sidebar.dictionary",
    icon: BookOpen,
    component: DictionarySection,
    group: "hub",
    enabled: () => true,
  },
  snippets: {
    labelKey: "sidebar.snippets",
    icon: TextQuote,
    component: SnippetsSection,
    group: "hub",
    enabled: () => true,
  },
  transforms: {
    labelKey: "sidebar.transforms",
    icon: Wand2,
    component: TransformsSection,
    group: "hub",
    enabled: () => true,
  },
  notes: {
    labelKey: "sidebar.notes",
    icon: NotebookPen,
    component: NotesPage,
    group: "workspace",
    enabled: () => true,
  },
  tasks: {
    labelKey: "sidebar.tasks",
    icon: CheckSquare,
    component: TasksSection,
    group: "workspace",
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    group: "workspace",
    enabled: () => true,
  },
  stats: {
    labelKey: "sidebar.stats",
    icon: BarChart3,
    component: StatsPage,
    group: "workspace",
    enabled: () => true,
  },
  personalize: {
    labelKey: "sidebar.personalize",
    icon: SlidersHorizontal,
    component: PersonalizeSettings,
    group: "system",
    enabled: () => false,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    group: "system",
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    group: "system",
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    group: "system",
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: null,
    group: "system",
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    group: "system",
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  const hubItems = availableSections.filter((s) => s.group === "hub");
  const workspaceItems = availableSections.filter(
    (s) => s.group === "workspace",
  );
  const systemItems = availableSections.filter((s) => s.group === "system");

  const dictateShortcut = settings?.bindings?.transcribe?.current_binding;

  const renderNavItem = (section: (typeof availableSections)[number]) => {
    const Icon = section.icon;
    const isActive = activeSection === section.id;

    return (
      <button
        key={section.id}
        type="button"
        className={`group relative flex gap-2.5 items-center px-3 py-2 w-full rounded-xl cursor-pointer transition-all text-left ${
          isActive
            ? "bg-surface text-text font-medium shadow-2xs border border-line ring-1 ring-logo-primary/20"
            : "text-ink-2 hover:bg-surface/60 hover:text-text border border-transparent"
        }`}
        onClick={() => onSectionChange(section.id)}
      >
        <Icon
          width={16}
          height={16}
          className={`shrink-0 transition-colors ${
            isActive ? "text-logo-primary" : "text-ink-3 group-hover:text-ink-1"
          }`}
        />
        <span
          className="text-[13px] truncate flex-1"
          title={t(section.labelKey)}
        >
          {t(section.labelKey)}
        </span>
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-logo-primary shrink-0" />
        )}
      </button>
    );
  };

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-sidebar border-e border-line px-3 py-4 justify-between select-none">
      <div className="space-y-4 overflow-y-auto">
        <div className="px-2 pt-1 pb-1 flex items-center justify-between">
          <UtterTextLogo width={124} />
          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-logo-primary/15 text-logo-primary">
            {t("sidebar.pro")}
          </span>
        </div>

        <div className="space-y-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            {t("sidebar.groups.dictation")}
          </p>
          <div className="space-y-0.5">{hubItems.map(renderNavItem)}</div>
        </div>

        <div className="pt-2 border-t border-line space-y-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            {t("sidebar.groups.workspace")}
          </p>
          <div className="space-y-0.5">{workspaceItems.map(renderNavItem)}</div>
        </div>
      </div>

      <div className="pt-3 border-t border-line space-y-2">
        <div className="space-y-0.5">{systemItems.map(renderNavItem)}</div>

        {/* Quick Shortcut Badge Widget */}
        <div className="mt-2 p-2.5 rounded-xl border border-line bg-surface/70 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] text-ink-2 font-medium">
              {t("sidebar.status.ready")}
            </span>
          </div>
          <kbd className="px-1.5 py-0.5 rounded-md border border-line bg-surface text-[10.5px] font-mono text-ink-2 font-semibold shadow-2xs">
            {dictateShortcut
              ? formatKeyCombination(dictateShortcut, osType)
              : "⌥ Space"}
          </kbd>
        </div>
      </div>
    </aside>
  );
};
