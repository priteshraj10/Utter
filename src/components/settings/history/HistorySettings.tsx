import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  BookOpen,
  Check,
  Copy,
  FileAudio,
  FilePlus,
  FolderOpen,
  NotebookPen,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  events,
  type HistoryEntry,
  type HistoryUpdatePayload,
} from "@/bindings";
import { useOsType } from "@/hooks/useOsType";
import { useSettings } from "@/hooks/useSettings";
import {
  useTranscriptionJobsStore,
  type ActiveJobStatus,
} from "@/stores/transcriptionJobsStore";
import { cn } from "@/lib/utils/cn";
import { AudioPlayer, AudioPlayerGroup } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { copyToClipboard } from "./clipboard";
import { pickAndTranscribeFiles } from "./transcribeFiles";

const IconButton: React.FC<{
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, disabled, active, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={cn(
      "grid size-7 place-items-center rounded-md transition-colors cursor-pointer",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      "disabled:pointer-events-none disabled:opacity-35",
      active
        ? "text-primary"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    )}
  >
    {children}
  </button>
);

/** Recordings kept by Cancel are named `cancelled-<timestamp>.wav` (utils.rs). */
const isCancelledRecording = (entry: HistoryEntry) =>
  entry.file_name.startsWith("cancelled-");

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Groups entries (newest first) into days, labelled Today, Yesterday, or a date. */
const groupByDay = (
  entries: HistoryEntry[],
  locale: string,
  labels: { today: string; yesterday: string },
) => {
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups: { key: number; label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.timestamp * 1000);
    const key = startOfDay(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === today
          ? labels.today
          : key === yesterday
            ? labels.yesterday
            : new Intl.DateTimeFormat(locale, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year:
                  date.getFullYear() === new Date().getFullYear()
                    ? undefined
                    : "numeric",
              }).format(date);
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
};

const PAGE_SIZE = 30;

/** How long a deleted entry can be brought back before it is removed. */
const DELETE_UNDO_MS = 5000;

// Long text folds to this many lines until "Show more".
const FOLDED_LINES = 4;

interface HeaderButtonProps {
  onClick: () => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const HeaderButton: React.FC<HeaderButtonProps> = ({
  onClick,
  label,
  icon: Icon,
}) => (
  <Button onClick={onClick} variant="ghost" size="sm" title={label}>
    <Icon className="size-3.5" />
    <span>{label}</span>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const osType = useOsType();
  const jobs = useTranscriptionJobsStore((state) => state.jobs);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [query, setQuery] = useState("");
  // Matches for `query`; `null` while not searching.
  const [searchResults, setSearchResults] = useState<HistoryEntry[] | null>(
    null,
  );
  const sentinelRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HistoryEntry[]>([]);
  const loadingRef = useRef(false);

  // Keep ref in sync for use in IntersectionObserver callback
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const loadPage = useCallback(async (cursor?: number) => {
    const isFirstPage = cursor === undefined;
    if (!isFirstPage && loadingRef.current) return;
    loadingRef.current = true;

    if (isFirstPage) setLoading(true);

    try {
      const result = await commands.getHistoryEntries(
        cursor ?? null,
        PAGE_SIZE,
      );
      if (result.status === "ok") {
        const { entries: newEntries, has_more } = result.data;
        setEntries((prev) => {
          if (isFirstPage) return newEntries;
          const existingIds = new Set(prev.map((entry) => entry.id));
          return [
            ...prev,
            ...newEntries.filter((entry) => !existingIds.has(entry.id)),
          ];
        });
        setHasMore(has_more);
      }
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // Search, debounced so typing doesn't query on every key.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await commands.searchHistoryEntries(trimmed);
      if (!cancelled && result.status === "ok") setSearchResults(result.data);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        const first = observerEntries[0];
        if (first.isIntersecting) {
          const lastEntry = entriesRef.current[entriesRef.current.length - 1];
          if (lastEntry) {
            loadPage(lastEntry.id);
          }
        }
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMore, loadPage]);

  // Listen for new entries added from the transcription pipeline
  useEffect(() => {
    const unlisten = events.historyUpdatePayload.listen((event) => {
      const payload: HistoryUpdatePayload = event.payload;
      if (payload.action === "added") {
        setEntries((prev) => [
          payload.entry,
          ...prev.filter((entry) => entry.id !== payload.entry.id),
        ]);
      } else if (payload.action === "updated") {
        setEntries((prev) =>
          prev.map((e) => (e.id === payload.entry.id ? payload.entry : e)),
        );
      }
      // "deleted" and "toggled" are handled by optimistic updates only,
      // so we intentionally ignore them here to avoid double-mutation.
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const toggleSaved = async (id: number) => {
    // Optimistic update
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
    );
    try {
      const result = await commands.toggleHistoryEntrySaved(id);
      if (result.status !== "ok") {
        // Revert on failure
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
        );
      }
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
      // Revert on failure
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
      );
    }
  };

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

  // Deleting removes the audio for good, so it waits a few seconds behind an
  // Undo; the entry only disappears from view meanwhile.
  const deleteAudioEntry = async (id: number) => {
    const removed = entriesRef.current.find((e) => e.id === id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try {
        const result = await commands.deleteHistoryEntry(id);
        if (result.status !== "ok") loadPage();
      } catch (error) {
        console.error("Failed to delete entry:", error);
        loadPage();
      }
    }, DELETE_UNDO_MS);
    toast(t("home.deleted"), {
      duration: DELETE_UNDO_MS,
      action: {
        label: t("home.undo"),
        onClick: () => {
          undone = true;
          window.clearTimeout(timer);
          if (removed) {
            setEntries((prev) =>
              [...prev, removed].sort((x, y) => y.timestamp - x.timestamp),
            );
          }
        },
      },
    });
  };

  const transcribeFile = async () => {
    try {
      await pickAndTranscribeFiles();
    } catch (error) {
      console.error("Failed to pick a file to transcribe:", error);
      toast.error(t("settings.history.transcribeFailed"));
    }
  };

  const openRecordingsFolder = async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  let content: React.ReactNode;
  const visibleEntries = searchResults ?? entries;
  const message = (text: string) => (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );

  if (searchResults && searchResults.length === 0) {
    content = message(t("settings.history.noMatches", { query: query.trim() }));
  } else if (loading) {
    content = message(t("settings.history.loading"));
  } else if (entries.length === 0) {
    content = message(t("settings.history.empty"));
  } else {
    const groups = groupByDay(visibleEntries, i18n.language, {
      today: t("home.today"),
      yesterday: t("home.yesterday"),
    });
    content = (
      <AudioPlayerGroup>
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                {group.entries.map((entry) => (
                  <HistoryEntryComponent
                    key={entry.id}
                    entry={entry}
                    job={jobs[entry.id]}
                    onToggleSaved={() => toggleSaved(entry.id)}
                    onCopyText={() =>
                      copyToClipboard(
                        entry.post_processed_text || entry.transcription_text,
                      )
                    }
                    getAudioUrl={getAudioUrl}
                    deleteAudio={deleteAudioEntry}
                    retryTranscription={commands.retryHistoryEntryTranscription}
                    cancelTranscription={
                      commands.cancelHistoryEntryTranscription
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        {/* Sentinel for infinite scroll */}
        {!searchResults && <div ref={sentinelRef} className="h-1" />}
      </AudioPlayerGroup>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-48 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.history.searchPlaceholder")}
            aria-label={t("settings.history.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <HeaderButton
          onClick={transcribeFile}
          label={t("settings.history.transcribeFile")}
          icon={FilePlus}
        />
        <HeaderButton
          onClick={openRecordingsFolder}
          label={t("settings.history.openFolder")}
          icon={FolderOpen}
        />
      </div>
      {content}
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  job?: ActiveJobStatus;
  onToggleSaved: () => void;
  onCopyText: () => Promise<boolean>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  retryTranscription: (id: number) => Promise<void>;
  cancelTranscription: (id: number) => Promise<void>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  job,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
  retryTranscription,
  cancelTranscription,
}) => {
  const { t, i18n } = useTranslation();
  const { refreshSettings } = useSettings();
  const [showCopied, setShowCopied] = useState(false);
  // Pressed cancel: a running job stops after its current chunk.
  const [cancelling, setCancelling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [showAudio, setShowAudio] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  const displayedText =
    !showRaw && entry.post_processed_text
      ? entry.post_processed_text
      : entry.transcription_text;

  // Queued or being transcribed in the background.
  const retrying = job !== undefined;
  useEffect(() => {
    if (!retrying) setCancelling(false);
  }, [retrying]);
  const hasTranscription = displayedText.trim().length > 0;
  const folded = hasTranscription && !retrying && !expanded;

  // Offer "Show more" only when the folded text is actually cut off.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !folded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [folded, displayedText]);

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [getAudioUrl, entry.file_name],
  );

  const handleCopyText = async () => {
    if (!hasTranscription) {
      return;
    }

    const copied = await onCopyText();
    if (!copied) {
      toast.error(t("settings.history.copyError"));
      return;
    }

    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleSaveToNotes = async () => {
    if (!hasTranscription) return;
    const title =
      displayedText
        .split(/[.\n!?]/)[0]
        ?.trim()
        .slice(0, 60) || t("notes.untitled");
    const res = await commands.createNote(title, displayedText);
    if (res.status === "ok") {
      toast.success(t("flow.savedToNotes"));
    } else {
      toast.error(res.error);
    }
  };

  const handleToggleEdit = () => {
    if (!editing) {
      setEditDraft(displayedText);
    }
    setEditing(!editing);
  };

  const handleLearnWords = async () => {
    const res = await commands.learnWordsFromEdit(displayedText, editDraft);
    if (res.status === "ok") {
      await refreshSettings();
      await copyToClipboard(editDraft);
      if (res.data.length > 0) {
        toast.success(
          t("settings.history.learnedWords", {
            words: res.data.join(", "),
          }),
        );
      } else {
        toast.info(t("settings.history.noNewWordsLearned"));
      }
      setEditing(false);
    } else {
      toast.error(res.error);
    }
  };

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
  };

  const time = new Intl.DateTimeFormat(i18n.language, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(entry.timestamp * 1000));
  const cancelled = isCancelledRecording(entry);
  const sourceLabel = cancelled
    ? t("home.cancelledRecording")
    : entry.source_name;

  let progressText = t("settings.history.transcribing");
  if (job?.state === "queued") {
    progressText = t("settings.history.waiting");
  } else if (job?.state === "running" && job.percent > 0) {
    progressText = t("settings.history.transcribingPercent", {
      percent: job.percent,
    });
  }

  return (
    <li className="group relative grid grid-cols-[4.5rem_1fr] gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
      <time
        dateTime={new Date(entry.timestamp * 1000).toISOString()}
        className="pt-0.5 text-xs tabular-nums text-muted-foreground"
      >
        {time}
      </time>

      <div className="min-w-0 space-y-2 pe-1">
        {(entry.post_processed_text || sourceLabel || entry.saved) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            {entry.saved && (
              <Star
                size={12}
                className="text-primary"
                fill="currentColor"
                aria-label={t("settings.history.save")}
              />
            )}
            {sourceLabel && (
              <span
                className="flex min-w-0 items-center gap-1 text-muted-foreground"
                title={sourceLabel}
              >
                <FileAudio size={12} className="shrink-0" />
                <span className="truncate">{sourceLabel}</span>
              </span>
            )}
            {entry.post_processed_text && (
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/15 cursor-pointer"
                title={t("settings.history.toggleRawHint")}
              >
                <Sparkles size={11} />
                {showRaw
                  ? t("settings.history.rawBadge")
                  : t("settings.history.aiCleanedBadge")}
              </button>
            )}
          </div>
        )}

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              className="w-full min-h-20 rounded-lg border border-input bg-background p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("settings.history.learnWordsHint")}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  {t("common.close")}
                </Button>
                <Button variant="primary" size="sm" onClick={handleLearnWords}>
                  {t("settings.history.learnAndCopy")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <p
              ref={textRef}
              className={cn(
                "w-full text-sm leading-relaxed",
                retrying
                  ? "text-muted-foreground animate-pulse"
                  : hasTranscription
                    ? "text-foreground select-text cursor-text whitespace-pre-wrap break-words"
                    : "text-muted-foreground",
              )}
              style={
                folded
                  ? {
                      display: "-webkit-box",
                      WebkitLineClamp: FOLDED_LINES,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
                  : undefined
              }
            >
              {retrying
                ? progressText
                : hasTranscription
                  ? displayedText
                  : cancelled
                    ? t("home.cancelledHint")
                    : entry.source_name
                      ? t("settings.history.notTranscribed")
                      : t("settings.history.transcriptionFailed")}
            </p>
            {hasTranscription && !retrying && (expanded || overflows) && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {expanded
                  ? t("settings.history.showLess")
                  : t("settings.history.showMore")}
              </button>
            )}
            {!hasTranscription && !retrying && (
              <Button
                variant="primary-soft"
                size="sm"
                className="mt-1"
                onClick={() => retryTranscription(entry.id)}
              >
                <RotateCcw size={13} />
                {t("home.transcribeNow")}
              </Button>
            )}
          </div>
        )}

        {showAudio && (
          <AudioPlayer
            onLoadRequest={handleLoadAudio}
            autoPlay
            className="w-full"
          />
        )}
      </div>

      {/* Actions: revealed on hover or keyboard focus, so the feed reads as text. */}
      <div className="absolute end-3 top-2 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          onClick={handleCopyText}
          disabled={!hasTranscription || retrying}
          title={t("settings.history.copyToClipboard")}
        >
          {showCopied ? <Check size={15} /> : <Copy size={15} />}
        </IconButton>
        <IconButton
          onClick={() => setShowAudio(!showAudio)}
          active={showAudio}
          title={showAudio ? t("home.hideRecording") : t("home.playRecording")}
        >
          <Play size={15} />
        </IconButton>
        <IconButton
          onClick={handleSaveToNotes}
          disabled={!hasTranscription || retrying}
          title={t("flow.saveAsNote")}
        >
          <NotebookPen size={15} />
        </IconButton>
        <IconButton
          onClick={handleToggleEdit}
          disabled={!hasTranscription || retrying}
          active={editing}
          title={t("settings.history.editAndLearn")}
        >
          <BookOpen size={15} />
        </IconButton>
        <IconButton
          onClick={onToggleSaved}
          active={entry.saved}
          title={
            entry.saved
              ? t("settings.history.unsave")
              : t("settings.history.save")
          }
        >
          <Star size={15} fill={entry.saved ? "currentColor" : "none"} />
        </IconButton>
        {retrying ? (
          <IconButton
            onClick={() => {
              setCancelling(true);
              void cancelTranscription(entry.id);
            }}
            disabled={cancelling}
            title={t("settings.history.cancelTranscription")}
          >
            <X size={15} />
          </IconButton>
        ) : (
          <IconButton
            onClick={() => retryTranscription(entry.id)}
            title={t("settings.history.retranscribe")}
          >
            <RotateCcw size={15} />
          </IconButton>
        )}
        <IconButton
          onClick={handleDeleteEntry}
          title={t("settings.history.delete")}
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
    </li>
  );
};
