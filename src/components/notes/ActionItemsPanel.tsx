import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, CheckCircle2, ListTodo, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { commands, type Note } from "@/bindings";
import {
  parseActionItems,
  toggleCheckboxLine,
  type ActionItem,
} from "./noteUtils";
import { Checkbox } from "../ui/checkbox";
import { Badge } from "../ui/Badge";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";

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
    <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header with stats and progress */}
      <CardHeader className="py-4 border-b border-line bg-surface/40 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-logo-primary/10 border border-logo-primary/20 flex items-center justify-center text-logo-primary shadow-2xs">
              <ListTodo size={17} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span>{t("notes.actions.title")}</span>
                <Badge variant="brand">
                  {t("notes.actions.openCount", { count: openCount })}
                </Badge>
              </CardTitle>
              <p className="text-xs text-ink-3">
                {t("notes.actions.subtitle")}
              </p>
            </div>
          </div>

          {/* Toggle show/hide completed */}
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-sidebar text-xs text-ink-2 font-medium transition-colors cursor-pointer"
          >
            <Checkbox
              checked={showDone}
              onCheckedChange={() => setShowDone(!showDone)}
            />
            <span>{t("notes.actions.showDone")}</span>
            <span className="text-[10px] text-ink-3 font-mono">
              ({doneCount})
            </span>
          </button>
        </div>

        {/* Progress Bar */}
        {totalCount > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-ink-3">
              <span>{t("notes.actions.progressLabel")}</span>
              <span className="font-semibold text-text font-mono">
                {`${progressPercent}% · ${doneCount}/${totalCount}`}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-sidebar overflow-hidden border border-line/40">
              <div
                className="h-full bg-logo-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      {/* Action items grouped by note */}
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-3 shadow-2xs">
              <CheckCircle2 size={24} />
            </div>
            <p className="text-sm font-medium text-text mb-1">
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
              className="rounded-xl border border-line bg-surface/50 hover:border-line/90 transition-all shadow-2xs overflow-hidden"
            >
              {/* Note Header / Source link */}
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-sidebar/50 border-b border-line/60">
                <button
                  type="button"
                  onClick={() => onOpenNote(note.id)}
                  className="group flex items-center gap-2 text-xs font-semibold text-text hover:text-logo-primary transition-colors cursor-pointer text-left truncate"
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

                <Badge
                  variant={noteOpenCount === 0 ? "success" : "secondary"}
                  className="text-[10px]"
                >
                  {noteOpenCount === 0
                    ? t("notes.actions.complete")
                    : t("notes.actions.openStatus", { count: noteOpenCount })}
                </Badge>
              </div>

              {/* Items in this note */}
              <div className="p-2 space-y-1">
                {items.map((item) => (
                  <div
                    key={`${item.field}-${item.line}`}
                    className="w-full flex items-start gap-2.5 text-left text-sm px-2.5 py-2 rounded-lg hover:bg-sidebar/80 transition-all cursor-pointer group"
                    onClick={() => toggle(note, item)}
                  >
                    <div
                      className="shrink-0 mt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={item.done}
                        onCheckedChange={() => toggle(note, item)}
                      />
                    </div>
                    <span
                      className={`text-xs leading-relaxed transition-colors select-text ${
                        item.done
                          ? "line-through text-ink-3 decoration-ink-3/50"
                          : "text-text font-medium"
                      }`}
                    >
                      {item.text.replace(/\*\*/g, "")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
