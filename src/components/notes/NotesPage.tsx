import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Copy,
  FileDown,
  FileText,
  Headphones,
  ListTodo,
  Loader2,
  MessageCircleQuestion,
  Mic,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Square,
  Tag,
  Trash2,
  UploadCloud,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { commands, events, type Note } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { formatDateTime } from "@/utils/dateFormat";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import { Button } from "../ui/Button";
import { AudioPlayer } from "../ui/AudioPlayer";
import { MarkdownContent } from "../whats-new/MarkdownContent";
import { copyToClipboard } from "../settings/history/clipboard";
import { AskNotesPanel } from "./AskNotesPanel";
import { ActionItemsPanel } from "./ActionItemsPanel";
import {
  SUMMARY_TEMPLATES,
  formatDuration,
  matchesFilter,
  noteToMarkdown,
  parseActionItems,
  toggleCheckboxLine,
  type NoteFilter,
} from "./noteUtils";

/** Backend event emitted whenever a note is created, edited or deleted. */
const NOTES_CHANGED_EVENT = "notes-changed";

type Tab = "notes" | "ask" | "actions";

const FILTERS: NoteFilter[] = [
  "all",
  "pinned",
  "meeting",
  "voice",
  "text",
  "digest",
];

const KIND_ICONS: Record<string, typeof FileText> = {
  meeting: Users,
  voice: Mic,
  digest: CalendarDays,
  text: FileText,
};

const noteMatchesQuery = (note: Note, q: string) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    note.title.toLowerCase().includes(needle) ||
    note.body.toLowerCase().includes(needle) ||
    (note.summary ?? "").toLowerCase().includes(needle) ||
    note.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
};

export const NotesPage: React.FC<{ initialTab?: Tab }> = ({
  initialTab = "notes",
}) => {
  const { t, i18n } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [summarizing, setSummarizing] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const [digesting, setDigesting] = useState(false);
  const [template, setTemplate] = useState<string>("auto");
  const [tagInput, setTagInput] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: number; title: string; body: string }>();

  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const noteShortcut = getSetting("bindings")?.voice_note?.current_binding;

  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (n) => matchesFilter(n, filter) && noteMatchesQuery(n, query.trim()),
      ),
    [notes, filter, query],
  );
  const openActionCount = useMemo(
    () =>
      notes.reduce(
        (n, note) => n + parseActionItems(note).filter((i) => !i.done).length,
        0,
      ),
    [notes],
  );

  const load = useCallback(async () => {
    const result = await commands.listNotes(null);
    if (result.status === "ok") setNotes(result.data);
  }, []);

  const getAudioUrl = useCallback(
    async (fileName: string) => {
      try {
        const result = await commands.getAudioFilePath(fileName);
        if (result.status === "ok") {
          if (osType === "linux") {
            const fileData = await readFile(result.data);
            const blob = new Blob([fileData], { type: "audio/wav" });
            return URL.createObjectURL(blob);
          }
          return convertFileSrc(result.data, "asset");
        }
        return null;
      } catch (error) {
        console.error("Failed to get audio file path:", error);
        return null;
      }
    },
    [osType],
  );

  useEffect(() => {
    load();
  }, [load]);

  const notesRef = useRef<Note[]>([]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // Voice notes arrive from the recording pipeline; open a new one.
  useEffect(() => {
    const unlisten = listen<number>(NOTES_CHANGED_EVENT, async (event) => {
      const isNew = !notesRef.current.some((n) => n.id === event.payload);
      const result = await commands.listNotes(null);
      if (result.status !== "ok") return;
      setNotes(result.data);
      if (isNew && result.data.some((n) => n.id === event.payload)) {
        setQuery("");
        setFilter("all");
        setTab("notes");
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
      const active = phase === "started" || phase === "locked";
      setRecording(active);
      setRecordStart((start) => (active ? (start ?? Date.now()) : null));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // When recording is active, stream live words directly into the active note editor!
  useEffect(() => {
    const unlisten = events.streamTextEvent.listen((event) => {
      if (!recording) return;
      const { committed, tentative } = event.payload;
      const combined = (committed ? committed + " " : "") + tentative;
      if (combined.trim()) {
        setDraft((prev) => {
          if (!prev) return { title: "", body: combined };
          return { ...prev, body: combined };
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [recording]);

  // Tick the recording timer.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording]);

  // Load the selected note into the editor; also when coming back from another
  // tab, where action items may have edited it.
  useEffect(() => {
    setDraft(selected ? { title: selected.title, body: selected.body } : null);
    setTemplate(selected?.summary_template ?? defaultTemplate(selected));
    setTagInput("");
    // Only when switching notes or tabs: edits must not be overwritten by refreshes.
  }, [selectedId, tab]);

  // An AI title arrives after the summary; show it unless the user is typing.
  useEffect(() => {
    if (!selected || !draft || pendingSave.current) return;
    if (selected.title !== draft.title && draft.title === "") {
      setDraft({ ...draft, title: selected.title });
    }
  }, [selected?.title]);

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
    setTab("notes");
    setSelectedId(id);
  };

  const createNote = async () => {
    await flushSave();
    // An empty title lets the first AI summary name the note.
    const result = await commands.createNote("", "");
    if (result.status === "ok") {
      setTab("notes");
      setFilter("all");
      setSelectedId(result.data.id);
      setDraft({ title: "", body: "" });
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
    const result = await commands.summarizeNote(selected.id, template);
    setSummarizing(false);
    if (result.status === "error") {
      toast.error(result.error);
    } else {
      // Pick up the AI title, if one was written.
      const fresh = await commands.listNotes(null);
      if (fresh.status === "ok") {
        setNotes(fresh.data);
        const note = fresh.data.find((n) => n.id === selected.id);
        if (note && !pendingSave.current) {
          setDraft((d) => (d ? { ...d, title: note.title } : d));
        }
      }
    }
  };

  const createDigest = async () => {
    await flushSave();
    setDigesting(true);
    const result = await commands.createDailyDigest();
    setDigesting(false);
    if (result.status === "ok") {
      toast.success(t("notes.digest.created"));
      await load();
      setTab("notes");
      setFilter("all");
      setSelectedId(result.data.id);
    } else {
      toast.error(result.error);
    }
  };

  const togglePin = async () => {
    if (!selected) return;
    const result = await commands.setNotePinned(selected.id, !selected.pinned);
    if (result.status === "error") toast.error(result.error);
  };

  const addTag = async () => {
    if (!selected || !tagInput.trim()) return;
    const result = await commands.setNoteTags(selected.id, [
      ...selected.tags,
      ...tagInput.split(","),
    ]);
    if (result.status === "ok") setTagInput("");
    else toast.error(result.error);
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    await commands.setNoteTags(
      selected.id,
      selected.tags.filter((x) => x !== tag),
    );
  };

  const toggleSummaryCheckbox = async (line: number, done: boolean) => {
    if (!selected?.summary) return;
    await commands.updateNoteSummary(
      selected.id,
      toggleCheckboxLine(selected.summary, line, done),
    );
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

  const [importingAudio, setImportingAudio] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const importAudioFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("notes.audioFiles"),
            extensions: [
              "mp3",
              "m4a",
              "aac",
              "wav",
              "flac",
              "aif",
              "mp4",
              "mov",
            ],
          },
        ],
      });
      if (!picked || typeof picked !== "string") return;

      setImportingAudio(true);
      const fileName =
        picked
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") || "Imported Meeting";
      const toastId = toast.loading(t("notes.importingAudio"));

      const res = await commands.transcribeFile(picked);
      toast.dismiss(toastId);

      if (res.status === "error") {
        toast.error(res.error);
        return;
      }

      const transcriptText =
        res.data.post_processed_text || res.data.transcription_text;
      const noteRes = await commands.createNoteWithAudio(
        fileName,
        transcriptText,
        res.data.file_name,
        null,
        "meeting",
      );

      if (noteRes.status === "error") {
        toast.error(noteRes.error);
        return;
      }

      await commands.setNoteTags(noteRes.data.id, ["imported", "meeting"]);
      await load();
      setSelectedId(noteRes.data.id);
      setDraft({ title: fileName, body: transcriptText });
      toast.success(t("notes.importSuccess"));

      // Auto-summarize the imported meeting note
      setTimeout(async () => {
        setSummarizing(true);
        const sumRes = await commands.summarizeNote(noteRes.data.id, "meeting");
        setSummarizing(false);
        if (sumRes.status === "ok") {
          await load();
        }
      }, 200);
    } catch (err) {
      console.error("Failed to import audio:", err);
      toast.error(String(err));
    } finally {
      setImportingAudio(false);
    }
  };

  const copyNote = async () => {
    if (!draft || !selected) return;
    const markdown = noteToMarkdown(selected, draft, {
      untitled: t("notes.untitled"),
      summary: t("notes.markdown.summary"),
      transcript: t("notes.markdown.transcript"),
    });
    if (await copyToClipboard(markdown)) toast.success(t("notes.copied"));
  };

  const copySummaryOnly = async () => {
    if (!selected?.summary) return;
    if (await copyToClipboard(selected.summary)) {
      toast.success(t("notes.summaryCopied"));
      setExportMenuOpen(false);
    }
  };

  const copyActionItemsOnly = async () => {
    if (!selected) return;
    const items = parseActionItems(selected);
    if (items.length === 0) {
      toast.info(t("notes.actions.empty"));
      return;
    }
    const text = items
      .map((i) => `- [${i.done ? "x" : " "}] ${i.text}`)
      .join("\n");
    if (await copyToClipboard(text)) {
      toast.success(t("notes.actionsCopied"));
      setExportMenuOpen(false);
    }
  };

  const exportMarkdownFile = async () => {
    if (!draft || !selected) return;
    try {
      const defaultName = `${(draft.title || t("notes.untitled")).replace(/[/\\?%*:|"<>]/g, "-")}.md`;
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      const markdown = noteToMarkdown(selected, draft, {
        untitled: t("notes.untitled"),
        summary: t("notes.markdown.summary"),
        transcript: t("notes.markdown.transcript"),
      });
      await writeTextFile(path, markdown);
      toast.success(t("notes.noteExported"));
      setExportMenuOpen(false);
    } catch (err) {
      console.error("Failed to export markdown file:", err);
      toast.error(String(err));
    }
  };

  const summaryItems = selected ? parseActionItems(selected) : [];

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-3 h-[calc(100vh-2rem)] min-h-[460px]">
      {/* Top bar: tabs, recording and digest */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface/70 p-1 shadow-2xs backdrop-blur-md">
          {(
            [
              ["notes", NotebookPen, t("notes.tabs.notes")],
              ["ask", MessageCircleQuestion, t("notes.tabs.ask")],
              [
                "actions",
                CheckSquare,
                openActionCount > 0
                  ? `${t("notes.tabs.actions")} (${openActionCount})`
                  : t("notes.tabs.actions"),
              ],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={async () => {
                await flushSave();
                if (id === "notes") await load();
                setTab(id);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                tab === id
                  ? "bg-surface text-text shadow-2xs border border-line ring-1 ring-logo-primary/20"
                  : "text-ink-3 hover:text-text hover:bg-surface/50 border border-transparent"
              }`}
            >
              <Icon
                size={14}
                className={tab === id ? "text-logo-primary" : "text-ink-3"}
              />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 shadow-2xs"
            onClick={createDigest}
            disabled={digesting}
            title={t("notes.digest.hint")}
          >
            {digesting ? (
              <Loader2 size={13} className="animate-spin text-logo-primary" />
            ) : (
              <CalendarDays size={13} className="text-teal-600" />
            )}
            <span className="text-xs font-medium">
              {digesting ? t("notes.digest.working") : t("notes.digest.button")}
            </span>
          </Button>

          <Button
            variant={recording ? "warning" : "primary"}
            size="sm"
            className="flex items-center gap-2 rounded-xl px-4 py-1.5 shadow-2xs justify-center font-medium transition-all"
            onClick={() => commands.toggleVoiceNote()}
            title={
              noteShortcut
                ? t("notes.recordHint", {
                    shortcut: formatKeyCombination(noteShortcut, osType),
                  })
                : undefined
            }
          >
            {recording ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <Square size={12} />
                <span className="text-xs">
                  {t("notes.stop")}
                  {recordStart !== null &&
                    ` · ${formatDuration((now - recordStart) / 1000)}`}
                </span>
              </>
            ) : (
              <>
                <Mic size={14} />
                <span className="text-xs">{t("notes.recordMeeting")}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {tab === "ask" && <AskNotesPanel onOpenNote={select} />}
      {tab === "actions" && (
        <ActionItemsPanel notes={notes} onOpenNote={select} />
      )}

      {tab === "notes" && (
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Sidebar */}
          <div className="w-72 shrink-0 flex flex-col gap-2">
            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl border border-line bg-surface/80 focus-within:border-logo-primary focus-within:ring-1 focus-within:ring-logo-primary/20 shadow-2xs">
                <Search size={14} className="text-ink-3 shrink-0" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("notes.searchPlaceholder")}
                  className="w-full bg-transparent text-xs outline-none"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-xl px-2.5 shadow-2xs"
                onClick={createNote}
                title={t("notes.new")}
              >
                <Plus size={14} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-xl px-2.5 shadow-2xs"
                onClick={importAudioFile}
                disabled={importingAudio}
                title={t("notes.importAudio")}
              >
                {importingAudio ? (
                  <Loader2
                    size={14}
                    className="animate-spin text-logo-primary"
                  />
                ) : (
                  <UploadCloud size={14} />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border cursor-pointer transition-all ${
                    filter === f
                      ? "border-logo-primary bg-logo-primary/15 text-logo-primary shadow-2xs"
                      : "border-line bg-surface/60 text-ink-3 hover:border-line hover:text-text"
                  }`}
                >
                  {t(`notes.filters.${f}`)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 p-1 rounded-2xl border border-line bg-surface/40">
              {visibleNotes.length === 0 && (
                <div className="p-6 text-center text-xs text-ink-3">
                  {query.trim() || filter !== "all"
                    ? t("notes.noMatches")
                    : t("notes.empty")}
                </div>
              )}
              {visibleNotes.map((note) => {
                const KindIcon = KIND_ICONS[note.kind] ?? FileText;
                const isSelected = note.id === selectedId;
                const preview = (note.summary || note.body).trim();

                return (
                  <button
                    key={note.id}
                    onClick={() => select(note.id)}
                    className={`w-full text-left p-3 rounded-xl border cursor-pointer transition-all space-y-1 ${
                      isSelected
                        ? "bg-surface border-line shadow-2xs ring-1 ring-logo-primary/25"
                        : "bg-surface/50 border-transparent hover:bg-surface hover:border-line/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <KindIcon
                          size={13}
                          className={
                            isSelected ? "text-logo-primary" : "text-ink-3"
                          }
                        />
                        <span className="text-xs font-semibold text-text truncate">
                          {note.title || t("notes.untitled")}
                        </span>
                      </div>
                      {note.pinned && (
                        <Pin size={11} className="shrink-0 text-logo-primary" />
                      )}
                    </div>

                    {preview && (
                      <p className="text-[11px] text-ink-2 line-clamp-2 leading-relaxed">
                        {preview}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-0.5 text-[10px] text-ink-3">
                      <span>
                        {formatDateTime(String(note.updated_at), i18n.language)}
                      </span>
                      {note.audio_seconds > 0 && (
                        <span>{formatDuration(note.audio_seconds)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-line bg-surface/80 shadow-2xs overflow-hidden">
            {!selected || !draft ? (
              <div className="m-auto max-w-md text-center space-y-3 p-6">
                <Mic size={28} className="mx-auto text-logo-primary" />
                <p className="text-sm font-medium">{t("notes.introTitle")}</p>
                <p className="text-sm text-ink-3">
                  {noteShortcut
                    ? t("notes.introBody", {
                        shortcut: formatKeyCombination(noteShortcut, osType),
                      })
                    : t("notes.introBodyNoShortcut")}
                </p>
                <ul className="text-xs text-ink-3 text-left space-y-1 pt-2">
                  <li>• {t("notes.introFeatures.templates")}</li>
                  <li>• {t("notes.introFeatures.ask")}</li>
                  <li>• {t("notes.introFeatures.actions")}</li>
                  <li>• {t("notes.introFeatures.digest")}</li>
                </ul>
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
                    variant="secondary"
                    size="sm"
                    onClick={togglePin}
                    title={selected.pinned ? t("notes.unpin") : t("notes.pin")}
                  >
                    {selected.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </Button>
                  <div className="relative">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      className="flex items-center gap-1"
                      title={t("notes.export")}
                    >
                      <Copy size={14} />
                      <ChevronDown size={11} className="text-ink-3" />
                    </Button>
                    {exportMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-line bg-surface/95 backdrop-blur-xl shadow-lg p-1.5 z-50 space-y-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            void copyNote();
                            setExportMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-ink hover:bg-line/40 transition-colors text-left cursor-pointer"
                        >
                          <FileText size={13} className="text-logo-primary" />
                          <span>{t("notes.copyFullMarkdown")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void copySummaryOnly()}
                          disabled={!selected.summary}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-ink hover:bg-line/40 disabled:opacity-40 transition-colors text-left cursor-pointer"
                        >
                          <Sparkles size={13} className="text-purple-400" />
                          <span>{t("notes.copySummaryOnly")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyActionItemsOnly()}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-ink hover:bg-line/40 transition-colors text-left cursor-pointer"
                        >
                          <ListTodo size={13} className="text-emerald-400" />
                          <span>{t("notes.copyActionItemsOnly")}</span>
                        </button>
                        <div className="border-t border-line/50 my-1" />
                        <button
                          type="button"
                          onClick={() => void exportMarkdownFile()}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-ink hover:bg-line/40 transition-colors text-left cursor-pointer"
                        >
                          <FileDown size={13} className="text-cyan-400" />
                          <span>{t("notes.exportMarkdownFile")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={deleteNote}
                    title={t("notes.delete")}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                {selected.audio_file && (
                  <div className="flex items-center gap-3 px-4 py-2 border-b border-line bg-surface-1/40">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3 shrink-0">
                      <Headphones size={13} className="text-logo-primary" />
                      <span>{t("notes.audioRecording")}</span>
                      {selected.audio_seconds > 0 && (
                        <span className="text-[11px] font-mono text-ink-4">
                          ({formatDuration(selected.audio_seconds)})
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <AudioPlayer
                        key={selected.audio_file}
                        onLoadRequest={() => getAudioUrl(selected.audio_file!)}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                {/* Summary controls */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line">
                  <Sparkles size={13} className="text-logo-primary" />
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="px-2 py-1 rounded-md border border-line bg-background text-xs outline-none focus:border-logo-primary cursor-pointer"
                    title={t("notes.templates.label")}
                  >
                    {SUMMARY_TEMPLATES.map((id) => (
                      <option key={id} value={id}>
                        {t(`notes.templates.${id}`)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="primary-soft"
                    size="sm"
                    className="flex items-center gap-1.5"
                    onClick={summarize}
                    disabled={summarizing || !draft.body.trim()}
                  >
                    {summarizing && (
                      <Loader2 size={13} className="animate-spin" />
                    )}
                    {summarizing
                      ? t("notes.summarizing")
                      : selected.summary
                        ? t("notes.resummarize")
                        : t("notes.summarize")}
                  </Button>
                  <div className="flex-1" />
                  <div className="flex flex-wrap items-center gap-1">
                    <Tag size={12} className="text-ink-3" />
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] bg-logo-primary/15"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="cursor-pointer text-ink-3 hover:text-ink-1"
                          title={t("notes.tags.remove")}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder={t("notes.tags.add")}
                      className="w-20 bg-transparent text-[11px] outline-none border-b border-transparent focus:border-logo-primary"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-b border-line bg-surface-1/50">
                  <span className="text-[11px] font-medium text-ink-3 flex items-center gap-1 mr-1">
                    <Wand2 size={11} className="text-logo-primary" />
                    {t("notes.aiRewriteLabel")}
                  </span>
                  {(
                    [
                      [
                        "default_improve_transcriptions",
                        "flow.transforms.cleanUp",
                      ],
                      ["style_concise", "flow.transforms.concise"],
                      ["style_bullets", "flow.transforms.bullets"],
                      ["style_email", "flow.transforms.email"],
                      [
                        "Turn into a checklist of action items with '- [ ] '",
                        "notes.transformActionItems",
                      ],
                      [
                        "Translate into English, keeping the formatting",
                        "notes.transformTranslate",
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
                  {transforming && (
                    <Loader2
                      size={12}
                      className="animate-spin text-logo-primary"
                    />
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {selected.summary && (
                    <div className="rounded-xl bg-gradient-to-br from-logo-primary/10 via-surface to-surface border border-logo-primary/25 p-4 text-sm space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-logo-primary flex items-center gap-1.5">
                          <Sparkles size={12} />
                          {t(
                            `notes.templates.${selected.summary_template ?? "auto"}`,
                            { defaultValue: t("notes.templates.auto") },
                          )}
                        </p>
                      </div>
                      <MarkdownContent markdown={selected.summary} />
                      {summaryItems.some((i) => i.field === "summary") && (
                        <div className="pt-2 border-t border-logo-primary/20 space-y-0.5">
                          {summaryItems
                            .filter((i) => i.field === "summary")
                            .map((item) => (
                              <button
                                key={item.line}
                                type="button"
                                onClick={() =>
                                  toggleSummaryCheckbox(item.line, !item.done)
                                }
                                className="w-full flex items-start gap-2 text-left text-xs px-1.5 py-1 rounded-lg hover:bg-logo-primary/10 cursor-pointer transition-colors"
                              >
                                {item.done ? (
                                  <CheckSquare
                                    size={14}
                                    className="shrink-0 text-logo-primary"
                                  />
                                ) : (
                                  <Square
                                    size={14}
                                    className="shrink-0 text-ink-3"
                                  />
                                )}
                                <span
                                  className={
                                    item.done ? "line-through text-ink-3" : ""
                                  }
                                >
                                  {item.text.replace(/\*\*/g, "")}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                  <textarea
                    value={draft.body}
                    onChange={(e) => edit({ body: e.target.value })}
                    placeholder={t("notes.bodyPlaceholder")}
                    className="w-full min-h-[240px] h-full bg-transparent text-sm leading-relaxed outline-none resize-none font-sans"
                  />
                </div>

                <div className="px-4 py-2 border-t border-line bg-surface/50 flex items-center justify-between text-[11px] text-ink-3">
                  <span>
                    {t("notes.editor.stats", {
                      words: draft.body.trim().split(/\s+/).filter(Boolean)
                        .length,
                      characters: draft.body.length,
                    })}
                  </span>
                  <span>
                    {t("notes.editor.lastUpdated", {
                      date: formatDateTime(
                        String(selected.updated_at),
                        i18n.language,
                      ),
                    })}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function defaultTemplate(note: Note | null): string {
  return note?.kind === "meeting" ? "meeting" : "auto";
}
