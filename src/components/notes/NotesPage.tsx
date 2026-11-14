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
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  CalendarDays,
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
  Printer,
  Search,
  Sparkles,
  Square,
  Tag,
  Trash2,
  UploadCloud,
  Users,
  Video,
  Wand2,
  X,
  RotateCcw,
  MoreHorizontal,
  ListFilter,
  Check,
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
import { SpeakersPanel } from "./SpeakersPanel";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  Card,
  Badge,
  Checkbox,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui";
import {
  SUMMARY_TEMPLATES,
  formatDuration,
  matchesFilter,
  noteToMarkdown,
  parseActionItems,
  toggleCheckboxLine,
  type NoteFilter,
} from "./noteUtils";
import { looksMistranscribed, plainPreview } from "./noteText";

/** Backend event emitted whenever a note is created, edited or deleted. */
const NOTES_CHANGED_EVENT = "notes-changed";

/** Rewrites offered for a note's transcript: [prompt id or instruction, label key]. */
const REWRITES = [
  ["default_improve_transcriptions", "flow.transforms.cleanUp"],
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
] as const;

type Tab = "notes" | "ask" | "actions";
type ViewMode = "both" | "summary" | "transcript";

const FILTERS: NoteFilter[] = [
  "all",
  "pinned",
  "meeting",
  "video",
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
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: number; title: string; body: string }>();

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  // Notes whose recording was transcribed in a script the user doesn't speak
  // (before the language fix, English came out in Devanagari).
  const spokenKey = (getSetting("spoken_languages") ?? []).join(",");
  const garbled = useMemo(
    () =>
      notes.filter((n) =>
        looksMistranscribed(n, spokenKey ? spokenKey.split(",") : []),
      ),
    [notes, spokenKey],
  );
  const [fixing, setFixing] = useState(false);
  const fixGarbled = async () => {
    setFixing(true);
    const ids = garbled.map((n) => n.id);
    const progress = toast.loading(
      t("notes.garbled.working", { done: 0, count: ids.length }),
    );
    let failed = 0;
    for (const [i, id] of ids.entries()) {
      const res = await commands.retranscribeNote(id);
      if (res.status !== "ok") failed += 1;
      toast.loading(
        t("notes.garbled.working", { done: i + 1, count: ids.length }),
        { id: progress },
      );
    }
    setFixing(false);
    await load();
    if (failed > 0) {
      toast.error(t("notes.garbled.someFailed", { count: failed }), {
        id: progress,
      });
    } else {
      toast.success(t("notes.garbled.done"), { id: progress });
    }
  };
  const isVideoNote = useMemo(
    () =>
      Boolean(
        selected?.tags.some((t) => t === "video") ||
          selected?.tags.some((t) =>
            /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(t.replace(/^source:/, "")),
          ),
      ),
    [selected],
  );
  const sourcePath = useMemo(
    () =>
      selected?.tags
        .find((t) => t.startsWith("source:"))
        ?.replace(/^source:/, "") ?? null,
    [selected],
  );
  const videoSrc = useMemo(
    () => (sourcePath ? convertFileSrc(sourcePath, "asset") : null),
    [sourcePath],
  );
  const noteShortcut = getSetting("bindings")?.voice_note?.current_binding;

  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (n) => matchesFilter(n, filter) && noteMatchesQuery(n, query.trim()),
      ),
    [notes, filter, query],
  );
  // Open the newest note rather than an empty pane, so the latest
  // conversation is the first thing you see.
  useEffect(() => {
    if (tab === "notes" && selectedId === null && visibleNotes.length > 0) {
      setSelectedId(visibleNotes[0].id);
    }
  }, [tab, selectedId, visibleNotes]);

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

  // Notifies user when an interrupted/crashed recording is recovered on startup
  useEffect(() => {
    const unlisten = listen<{
      id: number;
      title: string;
      audio_seconds: number;
    }>("note-recovered", (event) => {
      toast.success(t("notes.recoveredNotice"));
      setSelectedId(event.payload.id);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

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

  // Discarding throws the audio away for good, so anything longer than a few
  // seconds asks first. Stop is the button that saves.
  const discardRecording = useCallback(async () => {
    const seconds = recordStart ? (Date.now() - recordStart) / 1000 : 0;
    if (seconds > 10) {
      const confirmed = await ask(
        t("notes.discardConfirm", {
          duration: formatDuration(seconds),
        }),
        {
          title: t("notes.discardTitle"),
          kind: "warning",
          okLabel: t("notes.discard"),
          cancelLabel: t("notes.keepRecording"),
        },
      );
      if (!confirmed) return;
    }
    await commands.cancelOperation();
  }, [recordStart, t]);

  const [liveStreamText, setLiveStreamText] = useState("");
  const lastLoadedIdRef = useRef<number | null>(null);

  // When recording is active, stream live words directly
  useEffect(() => {
    if (!recording) {
      setLiveStreamText("");
      return;
    }
    const unlisten = events.streamTextEvent.listen((event) => {
      const { committed, tentative } = event.payload;
      const combined = (committed ? committed + " " : "") + tentative;
      setLiveStreamText(combined);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [recording]);

  // Tick the recording timer
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording]);

  // Synchronize draft when selection changes or when the selected note updates from backend
  useEffect(() => {
    if (!selected) {
      lastLoadedIdRef.current = null;
      setDraft(null);
      return;
    }

    const isNewSelection = lastLoadedIdRef.current !== selected.id;
    lastLoadedIdRef.current = selected.id;

    if (isNewSelection) {
      setDraft({ title: selected.title, body: selected.body });
      setTemplate(selected.summary_template ?? defaultTemplate(selected));
      setTagInput("");
    } else {
      // Background update (e.g. AI title, AI summary, or fresh save from backend)
      // Only sync if user is not currently in the middle of unsaved typing
      if (!pendingSave.current) {
        setDraft((prev) => {
          if (!prev) return { title: selected.title, body: selected.body };
          return {
            title: selected.title || prev.title,
            body: selected.body || prev.body,
          };
        });
      }
    }
  }, [selected, tab]);

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

  const importMediaFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("notes.mediaFiles"),
            extensions: [
              "mp3",
              "m4a",
              "aac",
              "wav",
              "flac",
              "aif",
              "ogg",
              "mp4",
              "mov",
              "mkv",
              "webm",
              "m4v",
              "avi",
            ],
          },
        ],
      });
      if (!picked || typeof picked !== "string") return;

      const isVideoFile = /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(picked);
      setImportingAudio(true);
      const fileName =
        picked
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") || "Imported Meeting";
      const toastId = toast.loading(
        isVideoFile ? t("notes.importingMedia") : t("notes.importingAudio"),
      );

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

      const tags = ["imported", "meeting"];
      if (isVideoFile) {
        tags.push("video");
        tags.push(`source:${picked}`);
      }
      await commands.setNoteTags(noteRes.data.id, tags);
      await load();
      setSelectedId(noteRes.data.id);
      setDraft({ title: fileName, body: transcriptText });
      toast.success(
        isVideoFile ? t("notes.importMediaSuccess") : t("notes.importSuccess"),
      );

      setTimeout(async () => {
        setSummarizing(true);
        const sumRes = await commands.summarizeNote(noteRes.data.id, "meeting");
        setSummarizing(false);
        if (sumRes.status === "ok") {
          await load();
        }
      }, 200);
    } catch (err) {
      console.error("Failed to import media file:", err);
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
    } catch (err) {
      console.error("Failed to export markdown file:", err);
      toast.error(String(err));
    }
  };

  // Re-runs the speech model on the recording, e.g. after a wrong-language
  // transcript; the new text and summary arrive via notes-changed.
  const retranscribe = async () => {
    if (!selected) return;
    await flushSave();
    const id = selected.id;
    toast.promise(
      commands.retranscribeNote(id).then((res) => {
        if (res.status !== "ok") throw new Error(res.error);
      }),
      {
        loading: t("notes.retranscribing"),
        success: t("notes.retranscribed"),
        error: (e) => String(e?.message ?? e),
      },
    );
  };

  const printNote = () => {
    if (!draft || !selected) return;
    const printWindow = window.open("", "_blank");
    // Note text is the user's: escape it, or a "<" or "&" breaks the page.
    const html = (text: string) =>
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\n/g, "<br/>");
    const title = html(draft.title || t("notes.untitled"));
    const summaryHtml = selected.summary
      ? `<div style="margin-bottom:24px;"><h2>${html(t("notes.tabSummary"))}</h2><div>${html(selected.summary)}</div></div>`
      : "";
    const bodyHtml = draft.body
      ? `<div style="margin-bottom:24px;"><h2>${html(t("notes.tabTranscript"))}</h2><div>${html(draft.body)}</div></div>`
      : "";

    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #111; line-height: 1.6; }
              h1 { font-size: 24px; border-bottom: 2px solid #eaeaea; padding-bottom: 10px; margin-bottom: 16px; }
              h2 { font-size: 16px; margin-top: 20px; color: #333; }
              .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
              .tag { display: inline-block; background: #f0f0f0; border-radius: 4px; padding: 2px 8px; margin-right: 6px; }
            </style>
          </head>
          <body>
            <h1>${title}</h1>
            <div class="meta">
              ${selected.tags.map((tg) => `<span class="tag">#${html(tg)}</span>`).join(" ")}
              <span>${formatDateTime(String(selected.updated_at), i18n.language)}</span>
            </div>
            ${summaryHtml}
            ${bodyHtml}
            <script>
              window.onload = function() { window.print(); window.close(); };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      window.print();
    }
  };

  const summaryItems = selected ? parseActionItems(selected) : [];

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-3 h-full min-h-[460px]">
      {/* Top bar: shadcn Tabs, recording and media controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1">
        <Tabs
          value={tab}
          onValueChange={(val) => {
            void flushSave();
            if (val === "notes") void load();
            setTab(val as Tab);
          }}
        >
          <TabsList className="bg-surface/80 shadow-2xs">
            <TabsTrigger value="notes" className="gap-2">
              <NotebookPen
                size={14}
                className={tab === "notes" ? "text-logo-primary" : "text-ink-3"}
              />
              <span>{t("notes.tabs.notes")}</span>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {notes.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="ask" className="gap-2">
              <MessageCircleQuestion
                size={14}
                className={tab === "ask" ? "text-logo-primary" : "text-ink-3"}
              />
              <span>{t("notes.tabs.ask")}</span>
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-2">
              <ListTodo
                size={14}
                className={
                  tab === "actions" ? "text-logo-primary" : "text-ink-3"
                }
              />
              <span>{t("notes.tabs.actions")}</span>
              {openActionCount > 0 && (
                <Badge variant="brand" className="px-1.5 py-0 text-[10px]">
                  {openActionCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t("notes.more")}
                title={t("notes.more")}
                disabled={importingAudio || digesting}
              >
                {importingAudio || digesting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <MoreHorizontal size={14} />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={importMediaFile}>
                <UploadCloud size={13} className="text-muted-foreground" />
                <span>{t("notes.importMedia")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={createDigest}>
                <CalendarDays size={13} className="text-muted-foreground" />
                <span>{t("notes.digest.button")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
          {/* Notes Sidebar List */}
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
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-ink-3 hover:text-text cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={filter === "all" ? "secondary" : "primary-soft"}
                    size="sm"
                    title={t("notes.filters.label")}
                    aria-label={t("notes.filters.label")}
                  >
                    <ListFilter size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {FILTERS.map((f) => (
                    <DropdownMenuItem key={f} onClick={() => setFilter(f)}>
                      <Check
                        size={13}
                        className={filter === f ? "opacity-100" : "opacity-0"}
                      />
                      <span>{t(`notes.filters.${f}`)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filter !== "all" && (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary cursor-pointer"
              >
                {t(`notes.filters.${filter}`)}
                <X size={10} />
              </button>
            )}

            {garbled.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning-wash p-3 text-xs text-foreground space-y-2">
                <p>{t("notes.garbled.message", { count: garbled.length })}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={fixGarbled}
                  disabled={fixing}
                >
                  {fixing && <Loader2 size={12} className="animate-spin" />}
                  {t("notes.garbled.fix", { count: garbled.length })}
                </Button>
              </div>
            )}

            {/* Note Cards List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 p-1 rounded-2xl border border-line bg-surface/40">
              {visibleNotes.length === 0 && (
                <div className="p-6 text-center text-xs text-ink-3">
                  {query.trim() || filter !== "all"
                    ? t("notes.noMatches")
                    : t("notes.empty")}
                </div>
              )}
              {visibleNotes.map((note) => {
                const isNoteVideo = note.tags.includes("video");
                const KindIcon = isNoteVideo
                  ? Video
                  : (KIND_ICONS[note.kind] ?? FileText);
                const isSelected = note.id === selectedId;
                const preview = plainPreview(note.summary || note.body);

                return (
                  <Card
                    key={note.id}
                    onClick={() => select(note.id)}
                    className={`w-full text-left p-3 cursor-pointer transition-all space-y-1.5 rounded-xl border ${
                      isSelected
                        ? "bg-surface border-line shadow-2xs ring-1 ring-logo-primary/25"
                        : "bg-surface/50 border-transparent hover:bg-surface hover:border-line"
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
                      <div className="flex items-center gap-1 shrink-0">
                        {isNoteVideo && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1 py-0 uppercase"
                          >
                            {t("notes.sourceVideo")}
                          </Badge>
                        )}
                        {note.pinned && (
                          <Pin
                            size={11}
                            className="shrink-0 text-logo-primary"
                          />
                        )}
                      </div>
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
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {formatDuration(note.audio_seconds)}
                        </Badge>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Active Note Editor & Minutes Workspace */}
          <Card className="flex-1 min-w-0 flex flex-col rounded-2xl border border-line bg-surface/80 shadow-2xs overflow-hidden">
            {recording ? (
              <div className="flex-1 flex flex-col p-6 space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-line">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-text">
                        {t("notes.recordMeeting")}
                      </h3>
                      <p className="text-xs text-ink-3">
                        {t("notes.liveStreamingHint")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="brand"
                      className="font-mono text-xs px-2.5 py-0.5"
                    >
                      {recordStart !== null
                        ? formatDuration((now - recordStart) / 1000)
                        : "00:00"}
                    </Badge>
                    <Button
                      variant="warning"
                      size="sm"
                      className="flex items-center gap-1.5 rounded-xl px-3 py-1 font-medium shadow-2xs"
                      onClick={() => commands.toggleVoiceNote()}
                    >
                      <Square size={12} />
                      <span>{t("notes.stop")}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-xl px-2.5 py-1"
                      onClick={discardRecording}
                      title={t("notes.discard")}
                      aria-label={t("notes.discard")}
                    >
                      <X size={13} />
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto rounded-xl border border-line/60 bg-surface/50 p-6 shadow-inner">
                  {liveStreamText ? (
                    <p className="text-base font-sans leading-relaxed text-text whitespace-pre-wrap select-text">
                      {liveStreamText}
                      <span className="inline-block w-2 h-4.5 bg-logo-primary animate-pulse ml-1.5 align-middle rounded-xs" />
                    </p>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center text-ink-3 space-y-3">
                      <Mic
                        size={32}
                        className="animate-pulse text-logo-primary"
                      />
                      <p className="text-sm font-medium">
                        {t("notes.listening")}
                      </p>
                      <p className="text-xs max-w-sm text-ink-3/80">
                        {t("notes.startSpeakingHint")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : !selected || !draft ? (
              <div className="m-auto max-w-sm text-center space-y-3.5 p-6">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-surface border border-line shadow-2xs flex items-center justify-center">
                  <Mic size={22} className="text-logo-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-text">
                    {t("notes.introTitle")}
                  </h3>
                  <p className="text-xs text-ink-3 leading-relaxed">
                    {noteShortcut
                      ? t("notes.introBody", {
                          shortcut: formatKeyCombination(noteShortcut, osType),
                        })
                      : t("notes.introBodyNoShortcut")}
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 shadow-2xs font-medium cursor-pointer"
                    onClick={() => commands.toggleVoiceNote()}
                  >
                    <Mic size={13} />
                    <span>{t("notes.recordMeeting")}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 shadow-2xs font-medium cursor-pointer"
                    onClick={createNote}
                  >
                    <Plus size={13} />
                    <span>{t("notes.new")}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 shadow-2xs font-medium cursor-pointer"
                    onClick={importMediaFile}
                    disabled={importingAudio}
                    title={t("notes.importMedia")}
                  >
                    <Video size={13} className="text-muted-foreground" />
                    <span>{t("notes.importMedia")}</span>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Note Header & Action Controls */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-surface/60">
                  <input
                    value={draft.title}
                    onChange={(e) => edit({ title: e.target.value })}
                    className="flex-1 min-w-0 bg-transparent text-base font-semibold outline-none"
                    placeholder={t("notes.untitled")}
                  />

                  {/* View Mode Segmented Controls */}
                  <div className="inline-flex rounded-lg border border-line bg-sidebar p-0.5 text-xs text-ink-3">
                    <button
                      type="button"
                      onClick={() => setViewMode("both")}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        viewMode === "both"
                          ? "bg-surface text-text shadow-2xs font-medium"
                          : "hover:text-text"
                      }`}
                    >
                      {t("common.all", { defaultValue: "Both" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("summary")}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        viewMode === "summary"
                          ? "bg-surface text-text shadow-2xs font-medium"
                          : "hover:text-text"
                      }`}
                    >
                      {t("notes.tabSummary")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("transcript")}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        viewMode === "transcript"
                          ? "bg-surface text-text shadow-2xs font-medium"
                          : "hover:text-text"
                      }`}
                    >
                      {t("notes.tabTranscript")}
                    </button>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={togglePin}
                    title={selected.pinned ? t("notes.unpin") : t("notes.pin")}
                  >
                    {selected.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </Button>

                  {/* shadcn DropdownMenu for Export & Copy */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex items-center gap-1"
                        title={t("notes.export")}
                      >
                        <Copy size={14} />
                        <ChevronDown size={11} className="text-ink-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={copyNote}>
                        <FileText size={13} className="text-logo-primary" />
                        <span>{t("notes.copyFullMarkdown")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={copySummaryOnly}
                        disabled={!selected.summary}
                      >
                        <Sparkles size={13} className="text-muted-foreground" />
                        <span>{t("notes.copySummaryOnly")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={copyActionItemsOnly}>
                        <ListTodo size={13} className="text-muted-foreground" />
                        <span>{t("notes.copyActionItemsOnly")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportMarkdownFile}>
                        <FileDown size={13} className="text-muted-foreground" />
                        <span>{t("notes.exportMarkdownFile")}</span>
                      </DropdownMenuItem>
                      {selected.audio_file && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={retranscribe}>
                            <RotateCcw
                              size={13}
                              className="text-muted-foreground"
                            />
                            <span>{t("notes.retranscribe")}</span>
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem onClick={printNote}>
                        <Printer size={13} className="text-muted-foreground" />
                        <span>{t("notes.printNote")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="warning"
                    size="sm"
                    onClick={deleteNote}
                    title={t("notes.delete")}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                {isVideoNote && videoSrc && (
                  <div className="p-3 border-b border-line bg-surface-1/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-ink-2 flex items-center gap-1.5">
                        <Video size={13} className="text-logo-primary" />
                        <span>{t("notes.videoPlayback")}</span>
                      </span>
                      {sourcePath && (
                        <span className="text-[11px] font-mono text-ink-4 truncate max-w-xs">
                          {sourcePath.split(/[\\/]/).pop()}
                        </span>
                      )}
                    </div>
                    <video
                      controls
                      playsInline
                      src={videoSrc}
                      className="w-full max-h-72 rounded-xl bg-black/90 border border-line shadow-md object-contain"
                    />
                  </div>
                )}

                {!isVideoNote && selected.audio_file && (
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

                <SpeakersPanel
                  note={selected}
                  body={draft.body}
                  onRename={(body, summary) => {
                    edit({ body });
                    if (summary !== selected.summary) {
                      void commands.updateNoteSummary(selected.id, summary);
                    }
                  }}
                />

                {/* Summary & Template Controls */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line">
                  <Sparkles size={13} className="text-logo-primary" />
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-line bg-surface text-xs outline-none focus:border-logo-primary cursor-pointer"
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={transforming || !draft.body.trim()}
                      >
                        {transforming ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Wand2 size={13} />
                        )}
                        {t("notes.aiRewriteLabel")}
                        <ChevronDown size={11} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {REWRITES.map(([inst, labelKey]) => (
                        <DropdownMenuItem
                          key={labelKey}
                          onClick={() => transformBody(inst)}
                        >
                          {t(labelKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="flex-1" />
                  <div className="flex flex-wrap items-center gap-1">
                    <Tag size={12} className="text-ink-3" />
                    {selected.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[11px] px-2 py-0.5 gap-1"
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
                      </Badge>
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

                {/* Content Workspace: Split or Single View */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {viewMode !== "transcript" && selected.summary && (
                    <Card className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-sm space-y-2.5 shadow-none">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="brand"
                          className="text-[11px] uppercase tracking-wider gap-1.5"
                        >
                          <Sparkles size={12} />
                          {t(
                            `notes.templates.${selected.summary_template ?? "auto"}`,
                            { defaultValue: t("notes.templates.auto") },
                          )}
                        </Badge>
                      </div>
                      <MarkdownContent markdown={selected.summary} />

                      {/* Interactive Checkbox Items */}
                      {summaryItems.some((i) => i.field === "summary") && (
                        <div className="pt-2 border-t border-logo-primary/20 space-y-1">
                          {summaryItems
                            .filter((i) => i.field === "summary")
                            .map((item) => (
                              <div
                                key={item.line}
                                onClick={() =>
                                  toggleSummaryCheckbox(item.line, !item.done)
                                }
                                className="w-full flex items-start gap-2.5 text-left text-xs px-2 py-1.5 rounded-lg hover:bg-logo-primary/10 cursor-pointer transition-colors"
                              >
                                <div
                                  className="shrink-0 mt-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    checked={item.done}
                                    onCheckedChange={(checked) =>
                                      toggleSummaryCheckbox(
                                        item.line,
                                        !!checked,
                                      )
                                    }
                                  />
                                </div>
                                <span
                                  className={`leading-relaxed ${
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
                      )}
                    </Card>
                  )}

                  {viewMode !== "summary" && (
                    <textarea
                      value={draft.body}
                      onChange={(e) => edit({ body: e.target.value })}
                      placeholder={t("notes.bodyPlaceholder")}
                      className="w-full min-h-[240px] h-full bg-transparent text-sm leading-relaxed outline-none resize-none font-sans"
                    />
                  )}
                </div>

                {/* Footer stats */}
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
          </Card>
        </div>
      )}
    </div>
  );
};

function defaultTemplate(note: Note | null): string {
  return note?.kind === "meeting" ? "meeting" : "auto";
}
