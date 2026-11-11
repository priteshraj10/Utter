import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cpu,
  FlaskConical,
  Home,
  Info,
  NotebookPen,
  Settings2,
  WandSparkles,
  Wrench,
} from "lucide-react";
import UtterTextLogo from "./icons/UtterTextLogo";
import { useSettings } from "../hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { GeneralSettings, ModelsSettings } from "./settings";
import type { AppSettings } from "@/bindings";
import { cn } from "@/lib/utils/cn";

const NotesPage = React.lazy(() =>
  import("./notes/NotesPage").then((m) => ({ default: m.NotesPage })),
);
const PersonalizePage = React.lazy(() =>
  import("./personalize/PersonalizePage").then((m) => ({
    default: m.PersonalizePage,
  })),
);
const HomePage = React.lazy(() =>
  import("./home/HomePage").then((m) => ({ default: m.HomePage })),
);
const AdvancedSettings = React.lazy(() =>
  import("./settings/advanced/AdvancedSettings").then((m) => ({
    default: m.AdvancedSettings,
  })),
);
const AboutSettings = React.lazy(() =>
  import("./settings/about/AboutSettings").then((m) => ({
    default: m.AboutSettings,
  })),
);

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  /** `null` when App renders the section itself (Debug, with its handlers). */
  component: React.ComponentType | null;
  group: "workspace" | "system";
  enabled: (settings: AppSettings | null | undefined) => boolean;
}

export const SECTIONS_CONFIG = {
  home: {
    labelKey: "sidebar.home",
    icon: Home,
    component: HomePage,
    group: "workspace",
    enabled: () => true,
  },
  notes: {
    labelKey: "sidebar.notes",
    icon: NotebookPen,
    component: NotesPage,
    group: "workspace",
    enabled: () => true,
  },
  personalize: {
    labelKey: "sidebar.personalize",
    icon: WandSparkles,
    component: PersonalizePage,
    group: "workspace",
    enabled: () => true,
  },
  general: {
    labelKey: "sidebar.settings",
    icon: Settings2,
    component: GeneralSettings,
    group: "system",
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    group: "system",
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Wrench,
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
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          isActive
            ? "bg-card text-foreground font-medium shadow-xs ring-1 ring-border"
            : "text-ink-2 hover:bg-accent hover:text-foreground",
        )}
        onClick={() => onSectionChange(section.id)}
      >
        <Icon
          width={16}
          height={16}
          className={cn(
            "shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate" title={t(section.labelKey)}>
          {t(section.labelKey)}
        </span>
      </button>
    );
  };

  return (
    <aside className="flex h-full w-52 shrink-0 select-none flex-col justify-between border-e border-border bg-sidebar px-2.5 py-4">
      <div className="space-y-5 overflow-y-auto">
        <div className="px-2.5 pt-1">
          <UtterTextLogo width={112} />
        </div>
        <nav className="space-y-0.5">{workspaceItems.map(renderNavItem)}</nav>
      </div>

      <div className="space-y-3">
        <nav className="space-y-0.5 border-t border-border pt-3">
          {systemItems.map(renderNavItem)}
        </nav>

        {dictateShortcut && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-xs">
            <span className="text-muted-foreground">
              {t("sidebar.dictate")}
            </span>
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
              {formatKeyCombination(dictateShortcut, osType)}
            </kbd>
          </div>
        )}
      </div>
    </aside>
  );
};
