import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, HardDrive, Sparkles, Zap } from "lucide-react";
import { commands, type LocalAiStatus } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { navigateTo } from "@/lib/navigation";
import { Button } from "../ui/Button";
import { SettingsGroup } from "../ui/SettingsGroup";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { resolveAiEngines, type AiEngine } from "./aiEngine";

/** Spoken commands the backend understands (utter.rs `apply_voice_commands` et al). */
const VOICE_COMMANDS = [
  "newLine",
  "newParagraph",
  "bullet",
  "scratchThat",
  "noWait",
  "pressEnter",
  "allCaps",
  "hashtag",
  "camelCase",
  "emoji",
  "search",
] as const;

const EngineRow: React.FC<{ task: "cleanup" | "notes"; engine: AiEngine }> = ({
  task,
  engine,
}) => {
  const { t } = useTranslation();
  const Icon =
    engine.kind === "provider"
      ? Sparkles
      : engine.kind === "local"
        ? HardDrive
        : engine.kind === "apple"
          ? Zap
          : Cpu;
  const name =
    engine.kind === "provider"
      ? engine.label
      : engine.kind === "local"
        ? t("personalize.engine.local", { model: engine.model })
        : t(`personalize.engine.${engine.kind}`);
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {t(`personalize.engine.task.${task}`)}
        </p>
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t(`personalize.engine.${engine.kind}Hint`)}
        </p>
      </div>
    </div>
  );
};

const EngineCard: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [local, setLocal] = useState<LocalAiStatus | null>(null);

  useEffect(() => {
    commands
      .checkAppleIntelligenceAvailable()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
    commands
      .localAiStatus()
      .then(setLocal)
      .catch(() => setLocal(null));
  }, []);

  const engines = resolveAiEngines(settings, appleAvailable, local);
  const providerSet = engines.cleanup.kind === "provider";

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        <EngineRow task="cleanup" engine={engines.cleanup} />
        <EngineRow task="notes" engine={engines.notes} />
      </div>
      {local?.installed && !local.running && !providerSet && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
          {t("personalize.engine.ollamaStopped")}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateTo("advanced")}
        >
          {providerSet
            ? t("personalize.engine.change")
            : t("personalize.engine.setUp")}
        </Button>
      </div>
    </div>
  );
};

export const SmartFeatures: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  // Cleanup needs post-processing on as well (actions.rs checks both).
  const cleanupOn =
    (getSetting("auto_cleanup") ?? false) &&
    (getSetting("post_process_enabled") ?? false);
  const setCleanup = async (on: boolean) => {
    await updateSetting("auto_cleanup", on);
    if (on && !getSetting("post_process_enabled")) {
      await updateSetting("post_process_enabled", true);
    }
  };

  const toggle = (
    key:
      | "voice_commands"
      | "context_awareness"
      | "whisper_mode"
      | "filler_word_removal_enabled",
    name: string,
  ) => (
    <ToggleSwitch
      grouped
      checked={getSetting(key) ?? false}
      onChange={(on) => updateSetting(key, on)}
      isUpdating={isUpdating(key)}
      label={t(`personalize.smart.${name}.label`)}
      description={t(`personalize.smart.${name}.description`)}
    />
  );

  return (
    <div className="space-y-6">
      <EngineCard />

      <SettingsGroup title={t("personalize.smart.title")}>
        <ToggleSwitch
          grouped
          checked={cleanupOn}
          onChange={setCleanup}
          isUpdating={isUpdating("auto_cleanup")}
          label={t("personalize.smart.cleanup.label")}
          description={t("personalize.smart.cleanup.description")}
        />
        {toggle("filler_word_removal_enabled", "fillers")}
        {toggle("context_awareness", "context")}
        {toggle("voice_commands", "voiceCommands")}
        {toggle("whisper_mode", "whisper")}
      </SettingsGroup>

      <SettingsGroup
        title={t("personalize.say.title")}
        description={t("personalize.say.description")}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2">
          {VOICE_COMMANDS.map((id) => (
            <div
              key={id}
              className="border-b border-border px-4 py-3 sm:odd:border-e [&:nth-last-child(-n+1)]:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <dt className="text-sm font-medium text-foreground">
                “{t(`personalize.say.commands.${id}.phrase`)}”
              </dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                {t(`personalize.say.commands.${id}.result`)}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>
    </div>
  );
};
