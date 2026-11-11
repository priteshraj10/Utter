import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Snippet } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";

const MAX_TRIGGER = 60;
const MAX_EXPANSION = 2000;
/** Placeholders the backend fills in when a snippet expands. */
const VARIABLES = ["{date}", "{time}", "{day}", "{datetime}"];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `snippet-${Date.now()}`;

/** Say a short phrase, get a longer text: an address, a sign-off, a link. */
export const SnippetsEditor: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const snippets = getSetting("snippets") ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");

  const cleanTrigger = trigger.replace(/\s+/g, " ").trim();
  const duplicate = snippets.some(
    (s) =>
      s.id !== editingId &&
      s.trigger.trim().toLowerCase() === cleanTrigger.toLowerCase(),
  );
  const canSave =
    cleanTrigger.length > 0 &&
    cleanTrigger.length <= MAX_TRIGGER &&
    expansion.trim().length > 0 &&
    expansion.length <= MAX_EXPANSION &&
    !duplicate;

  const reset = () => {
    setEditingId(null);
    setTrigger("");
    setExpansion("");
  };

  const save = async () => {
    if (!canSave) return;
    const next: Snippet[] = editingId
      ? snippets.map((s) =>
          s.id === editingId ? { ...s, trigger: cleanTrigger, expansion } : s,
        )
      : [...snippets, { id: newId(), trigger: cleanTrigger, expansion }];
    await updateSetting("snippets", next);
    reset();
  };

  const edit = (snippet: Snippet) => {
    setEditingId(snippet.id);
    setTrigger(snippet.trigger);
    setExpansion(snippet.expansion);
  };

  const remove = (id: string) => {
    updateSetting(
      "snippets",
      snippets.filter((s) => s.id !== id),
    );
    if (editingId === id) reset();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("personalize.snippets.trigger")}
            </span>
            <Input
              value={trigger}
              maxLength={MAX_TRIGGER}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder={t("personalize.snippets.triggerPlaceholder")}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("personalize.snippets.expansion")}
            </span>
            <Textarea
              variant="compact"
              value={expansion}
              maxLength={MAX_EXPANSION}
              onChange={(e) => setExpansion(e.target.value)}
              placeholder={t("personalize.snippets.expansionPlaceholder")}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {duplicate
              ? t("personalize.snippets.duplicate", { trigger: cleanTrigger })
              : t("personalize.snippets.variables", {
                  variables: VARIABLES.join("  "),
                })}
          </p>
          <div className="flex items-center gap-2">
            {editingId && (
              <Button variant="ghost" size="sm" onClick={reset}>
                {t("common.cancel")}
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!canSave}>
              {!editingId && <Plus size={14} />}
              {editingId
                ? t("personalize.snippets.update")
                : t("personalize.snippets.add")}
            </Button>
          </div>
        </div>
      </div>

      {snippets.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          {t("personalize.snippets.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          {snippets.map((snippet) => (
            <li
              key={snippet.id}
              className="group flex items-start gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  “{snippet.trigger}”
                </p>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {snippet.expansion}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => edit(snippet)}
                  aria-label={t("personalize.snippets.edit")}
                  title={t("personalize.snippets.edit")}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => remove(snippet.id)}
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
