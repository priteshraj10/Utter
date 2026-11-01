import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  Copy,
  Mic,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { commands, events, type Note } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { formatDateTime } from "@/utils/dateFormat";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import { Button } from "../ui/Button";
import { MarkdownContent } from "../whats-new/MarkdownContent";
import { copyToClipboard } from "../settings/history/clipboard";

/** Backend event emitted whenever a note is created, edited or deleted. */
const NOTES_CHANGED_EVENT = "notes-changed";

const formatDuration = (seconds: number) => {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const NotesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: number; title: string; body: string }>();

  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const noteShortcut = getSetting("bindings")?.voice_note?.current_binding;

  const load = useCallback(async () => {
    const result = await commands.listNotes(query.trim() || null);
    if (result.status === "ok") setNotes(result.data);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(load, 150);
    return () => clearTimeout(timer);
  }, [load]);
  // The event listener below outlives renders; it reloads through this.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const notesRef = useRef<Note[]>([]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // Voice notes arrive from the recording pipeline; open a new one.
  useEffect(() => {
    const unlisten = listen<number>(NOTES_CHANGED_EVENT, async (event) => {
      const isNew = !notesRef.current.some((n) => n.id === event.payload);
      if (!isNew) {
        // An edit, a summary or a delete: refresh within the current search.
        loadRef.current();
        return;
      }
      const result = await commands.listNotes(null);
      if (result.status !== "ok") return;
      setQuery("");
      setNotes(result.data);
      if (result.data.some((n) => n.id === event.payload)) {
        setSelectedId(event.payload);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = events.recordingStateEvent.listen((event) => {
      const phase = event.payload.phase;
      setRecording(phase === "started" || phase === "locked");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Load the selected note into the editor.
  useEffect(() => {
    setDraft(selected ? { title: selected.title, body: selected.body } : null);
    // Only when switching notes: edits must not be overwritten by refreshes.
  }, [selectedId]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingSave.current;
    pendingSave.current = undefined;
    if (pending) {
      await commands.updateNote(pending.id, pending.title, pending.body);
    }
  }, []);

  useEffect(() => () => void flushSave(), [flushSave]);

  const edit = (patch: Partial<{ title: string; body: string }>) => {
    if (!selected || !draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    pendingSave.current = { id: selected.id, ...next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 600);
  };

  const select = async (id: number) => {
    await flushSave();
    setSelectedId(id);
  };

  const createNote = async () => {
    await flushSave();
    const result = await commands.createNote(t("notes.untitled"), "");
    if (result.status === "ok") {
      setSelectedId(result.data.id);
      setDraft({ title: result.data.title, body: "" });
    }
  };

  const deleteNote = async () => {
    if (!selected) return;
    pendingSave.current = undefined;
    const result = await commands.deleteNote(selected.id);
    if (result.status === "ok") setSelectedId(null);
  };

  const summarize = async () => {
    if (!selected) return;
    await flushSave();
    setSummarizing(true);
    const result = await commands.summarizeNote(selected.id);
    setSummarizing(false);
    if (result.status === "error") toast.error(result.error);
  };

  const transformBody = async (instruction: string) => {
    if (!selected || !draft || !draft.body.trim()) return;
    setTransforming(true);
    const result = await commands.transformText(draft.body, instruction);
    setTransforming(false);
    if (result.status === "ok") {
      edit({ body: result.data });
    } else {
      toast.error(result.error);
    }
  };

  const copyNote = async () => {
    if (!draft) return;
    const text = selected?.summary
      ? `${draft.title}\n\n${selected.summary}\n\n${draft.body}`
      : `${draft.title}\n\n${draft.body}`;
    if (await copyToClipboard(text)) toast.success(t("notes.copied"));
  };

  return (
    <div className="max-w-5xl w-full mx-auto flex gap-4 h-[calc(100vh-2rem)] min-h-[420px]">
      <div className="w-64 shrink-0 flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            variant={recording ? "warning" : "primary"}
            size="sm"
            className="flex-1 flex items-center justify-center gap-1.5"
            onClick={() => commands.toggleVoiceNote()}
            title={
              noteShortcut
                ? t("notes.recordHint", {
                    shortcut: formatKeyCombination(noteShortcut, osType),
                  })
                : undefined
            }
          >
            {recording ? <Square size={14} /> : <Mic size={14} />}
            {recording ? t("notes.stop") : t("notes.record")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={createNote}
            title={t("notes.new")}
          >
            <Plus size={14} />
          </Button>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-background focus-within:border-logo-primary">
          <Search size={14} className="text-ink-3 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("notes.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <div className="flex-1 overflow-y-auto rounded-lg border border-line bg-background divide-y divide-line">
          {notes.length === 0 && (
            <p className="p-4 text-sm text-ink-3">
              {query.trim() ? t("notes.noMatches") : t("notes.empty")}
            </p>
          )}
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => select(note.id)}
              className={`w-full text-left px-3 py-2 cursor-pointer transition-colors ${
                note.id === selectedId
                  ? "bg-logo-primary/20"
                  : "hover:bg-line/60"
              }`}
            >
              <p className="text-sm font-medium truncate">
                {note.title || t("notes.untitled")}
              </p>
              <p className="text-xs text-ink-3 truncate">
                {formatDateTime(String(note.updated_at), i18n.language)}
                {note.audio_seconds > 0 &&
                  ` · ${formatDuration(note.audio_seconds)}`}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-line bg-background">
        {!selected || !draft ? (
          <div className="m-auto max-w-sm text-center space-y-2 p-6">
            <Mic size={28} className="mx-auto text-logo-primary" />
            <p className="text-sm font-medium">{t("notes.introTitle")}</p>
            <p className="text-sm text-ink-3">
              {noteShortcut
                ? t("notes.introBody", {
                    shortcut: formatKeyCombination(noteShortcut, osType),
                  })
                : t("notes.introBodyNoShortcut")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-line">
              <input
                value={draft.title}
                onChange={(e) => edit({ title: e.target.value })}
                className="flex-1 min-w-0 bg-transparent text-base font-semibold outline-none"
                placeholder={t("notes.untitled")}
              />
              <Button
                variant="primary-soft"
                size="sm"
                className="flex items-center gap-1.5"
                onClick={summarize}
                disabled={summarizing || !draft.body.trim()}
              >
                <Sparkles size={14} />
                {summarizing
                  ? t("notes.summarizing")
                  : selected.summary
                    ? t("notes.resummarize")
                    : t("notes.summarize")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={copyNote}
                title={t("notes.copy")}
              >
                <Copy size={14} />
              </Button>
              <Button
                variant="warning"
                size="sm"
                onClick={deleteNote}
                title={t("notes.delete")}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-b border-line bg-surface-1/50">
              <span className="text-[11px] font-medium text-ink-3 flex items-center gap-1 mr-1">
                <Wand2 size={11} className="text-logo-primary" />
                {t("notes.aiRewriteLabel")}
              </span>
              {(
                [
                  ["default_improve_transcriptions", "flow.transforms.cleanUp"],
                  ["style_concise", "flow.transforms.concise"],
                  ["style_bullets", "flow.transforms.bullets"],
                  ["style_email", "flow.transforms.email"],
                  [
                    "Turn into a checklist of action items with '- [ ] '",
                    "notes.transformActionItems",
                  ],
                ] as const
              ).map(([inst, labelKey]) => (
                <button
                  key={labelKey}
                  type="button"
                  disabled={transforming || !draft.body.trim()}
                  onClick={() => transformBody(inst)}
                  className="px-2 py-0.5 rounded text-xs border border-line bg-background hover:border-logo-primary disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selected.summary && (
                <div className="rounded-lg bg-logo-primary/10 border border-logo-primary/30 p-3 text-sm">
                  <MarkdownContent markdown={selected.summary} />
                </div>
              )}
              <textarea
                value={draft.body}
                onChange={(e) => edit({ body: e.target.value })}
                placeholder={t("notes.bodyPlaceholder")}
                className="w-full min-h-[240px] h-full bg-transparent text-sm leading-relaxed outline-none resize-none"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
