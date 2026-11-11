import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { commands, type AppStyle } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../ui/Button";
import { Dropdown } from "../ui/Dropdown";
import { Input } from "../ui/Input";

/** Styles that make sense per app; the cleanup prompt itself is excluded. */
const DEFAULT_PROMPT_ID = "default_improve_transcriptions";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `style-${Date.now()}`;

/** A writing style per app: casual in Slack, formal in Mail, code in an editor. */
export const AppStylesEditor: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const styles = getSetting("app_styles") ?? [];
  const prompts = getSetting("post_process_prompts") ?? [];
  const cleanupOn =
    (getSetting("auto_cleanup") ?? false) &&
    (getSetting("post_process_enabled") ?? false);
  const [app, setApp] = useState("");
  const [promptId, setPromptId] = useState<string | null>(null);
  const [topApps, setTopApps] = useState<string[]>([]);

  // Suggest the apps the user actually dictates into most.
  useEffect(() => {
    commands.getUsageStats().then((res) => {
      if (res.status === "ok") {
        setTopApps(res.data.top_apps.map((a) => a.app).filter(Boolean));
      }
    });
  }, []);

  const promptName = (id: string) =>
    prompts.find((p) => p.id === id)?.name ?? id;
  const styleOptions = prompts
    .filter((p) => p.id !== DEFAULT_PROMPT_ID)
    .map((p) => ({ value: p.id, label: p.name }));

  const styledApps = useMemo(
    () => new Set(styles.map((s) => s.app.trim().toLowerCase())),
    [styles],
  );
  const suggestions = topApps.filter(
    (name) => !styledApps.has(name.toLowerCase()),
  );

  const cleanApp = app.trim();
  const duplicate = styledApps.has(cleanApp.toLowerCase());
  const canAdd = cleanApp.length > 0 && !!promptId && !duplicate;

  const add = async () => {
    if (!canAdd || !promptId) return;
    const next: AppStyle[] = [
      ...styles,
      { id: newId(), app: cleanApp, prompt_id: promptId },
    ];
    await updateSetting("app_styles", next);
    setApp("");
    setPromptId(null);
  };

  const changeStyle = (id: string, prompt_id: string) =>
    updateSetting(
      "app_styles",
      styles.map((s) => (s.id === id ? { ...s, prompt_id } : s)),
    );

  const remove = (id: string) =>
    updateSetting(
      "app_styles",
      styles.filter((s) => s.id !== id),
    );

  return (
    <div className="space-y-6">
      {!cleanupOn && (
        <p className="rounded-lg border border-warning/30 bg-warning-wash px-3 py-2 text-xs text-foreground">
          {t("personalize.styles.needsCleanup")}
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("personalize.styles.app")}
            </span>
            <Input
              value={app}
              list="utter-style-apps"
              onChange={(e) => setApp(e.target.value)}
              placeholder={t("personalize.styles.appPlaceholder")}
            />
            <datalist id="utter-style-apps">
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("personalize.styles.style")}
            </span>
            <Dropdown
              options={styleOptions}
              selectedValue={promptId}
              onSelect={setPromptId}
              placeholder={t("personalize.styles.stylePlaceholder")}
              className="min-w-0"
            />
          </div>
          <Button onClick={add} disabled={!canAdd} className="h-8">
            <Plus size={14} />
            {t("personalize.styles.add")}
          </Button>
        </div>
        {duplicate ? (
          <p className="text-xs text-muted-foreground">
            {t("personalize.styles.duplicate", { app: cleanApp })}
          </p>
        ) : (
          suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t("personalize.styles.suggested")}
              </span>
              {suggestions.slice(0, 6).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setApp(name)}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-accent cursor-pointer"
                >
                  {name}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {styles.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          {t("personalize.styles.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-xs">
          {styles.map((style) => (
            <li key={style.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {style.app}
              </span>
              <Dropdown
                options={styleOptions}
                selectedValue={style.prompt_id}
                onSelect={(id) => changeStyle(style.id, id)}
                placeholder={promptName(style.prompt_id)}
                className="w-48"
              />
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={() => remove(style.id)}
                aria-label={t("common.delete")}
                title={t("common.delete")}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
