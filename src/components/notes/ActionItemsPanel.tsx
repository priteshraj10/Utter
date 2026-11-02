import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckSquare,
  Square,
  FileText,
  CheckCircle2,
  ListTodo,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { commands, type Note } from "@/bindings";
import {
  parseActionItems,
  toggleCheckboxLine,
  type ActionItem,
} from "./noteUtils";

/** Every checklist item across all notes, grouped by note. */
export const ActionItemsPanel: React.FC<{
  notes: Note[];
  onOpenNote: (id: number) => void;
}> = ({ notes, onOpenNote }) => {
  const { t } = useTranslation();
  const [showDone, setShowDone] = useState(false);

  const allItems = useMemo(() => {
    return notes.flatMap((note) =>
      parseActionItems(note).map((item) => ({ ...item, noteId: note.id })),
    );
  }, [notes]);

  const totalCount = allItems.length;
  const doneCount = allItems.filter((i) => i.done).length;
  const openCount = totalCount - doneCount;
  const progressPercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const groups = useMemo(() => {
    return notes
      .map((note) => {
        const items = parseActionItems(note);
        const filtered = items.filter((i) => showDone || !i.done);
        return {
          note,
          items: filtered,
          allCount: items.length,
          openCount: items.filter((i) => !i.done).length,
        };
      })
      .filter((g) => g.items.length > 0);
  }, [notes, showDone]);

  const toggle = async (note: Note, item: ActionItem) => {
    const done = !item.done;
    const result =
      item.field === "summary"
        ? await commands.updateNoteSummary(
            note.id,
            toggleCheckboxLine(note.summary ?? "", item.line, done),
          )
        : await commands.updateNote(
            note.id,
            note.title,
            toggleCheckboxLine(note.body, item.line, done),
          );
    if (result.status === "error") toast.error(result.error);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-line bg-surface/75 backdrop-blur-xl shadow-2xs overflow-hidden">
      {/* Header with stats and progress */}
      <div className="px-5 py-4 border-b border-line/70 bg-surface/40 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-logo-primary/10 border border-logo-primary/20 flex items-center justify-center text-logo-primary shadow-2xs">
              <ListTodo size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                <span>
                  {t("notes.actions.openCount", { count: openCount })}
                </span>
                {totalCount > 0 && (
                  <span className="text-[11px] font-medium text-ink-3 px-1.5 py-0.5 rounded-full bg-line/60">
                    {doneCount}/{totalCount}
                  </span>
                )}
              </h2>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-ink-2 hover:text-ink cursor-pointer select-none px-2.5 py-1.5 rounded-lg hover:bg-line/40 transition-colors">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="rounded border-line text-logo-primary focus:ring-logo-primary/30 w-3.5 h-3.5 cursor-pointer accent-logo-primary"
            />
            {t("notes.actions.showDone")}
          </label>
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 w-full bg-line/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-logo-primary to-cyan-400 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Action items list grouped by note */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-3 shadow-2xs">
              <CheckCircle2 size={24} />
            </div>
            <p className="text-sm font-medium text-ink mb-1">
              {openCount === 0 && totalCount > 0
                ? t("notes.actions.allDone")
                : t("notes.actions.empty")}
            </p>
            <p className="text-xs text-ink-3 max-w-xs">
              {totalCount > 0 && !showDone
                ? t("notes.actions.showDoneHint")
                : t("notes.actions.emptyHint")}
            </p>
          </div>
        ) : (
          groups.map(({ note, items, openCount: noteOpenCount }) => (
            <div
              key={note.id}
              className="rounded-xl border border-line/70 bg-background/80 hover:border-line transition-all shadow-2xs overflow-hidden"
            >
              {/* Note Header / Source link */}
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-surface/50 border-b border-line/40">
                <button
                  type="button"
                  onClick={() => onOpenNote(note.id)}
                  className="group flex items-center gap-2 text-xs font-semibold text-ink hover:text-logo-primary transition-colors cursor-pointer text-left truncate"
                >
                  <FileText
                    size={14}
                    className="shrink-0 text-ink-3 group-hover:text-logo-primary transition-colors"
                  />
                  <span className="truncate">
                    {note.title || t("notes.untitled")}
                  </span>
                  <ExternalLink
                    size={11}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-ink-3"
                  />
                </button>

                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-line/60 text-ink-3 shrink-0">
                  {noteOpenCount === 0
                    ? t("notes.actions.complete")
                    : t("notes.actions.openStatus", { count: noteOpenCount })}
                </span>
              </div>

              {/* Items in this note */}
              <div className="p-2 space-y-1">
                {items.map((item) => (
                  <button
                    key={`${item.field}-${item.line}`}
                    type="button"
                    onClick={() => toggle(note, item)}
                    className="w-full flex items-start gap-2.5 text-left text-sm px-2.5 py-2 rounded-lg hover:bg-surface/80 active:bg-surface transition-all cursor-pointer group"
                  >
                    <div className="shrink-0 mt-0.5 transition-transform group-hover:scale-105">
                      {item.done ? (
                        <CheckSquare
                          size={16}
                          className="text-logo-primary transition-colors"
                        />
                      ) : (
                        <Square
                          size={16}
                          className="text-ink-3 group-hover:text-ink-2 transition-colors"
                        />
                      )}
                    </div>
                    <span
                      className={`flex-1 text-xs leading-relaxed transition-colors ${
                        item.done
                          ? "line-through text-ink-3/70"
                          : "text-ink group-hover:text-ink font-normal"
                      }`}
                    >
                      {item.text.replace(/\*\*/g, "")}
                    </span>
                    {item.field === "summary" && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-3/60 px-1.5 py-0.5 rounded bg-line/40 shrink-0">
                        {t("notes.ai")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
