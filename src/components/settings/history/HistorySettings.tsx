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
import { formatDateTime } from "@/utils/dateFormat";
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
    onClick={onClick}
    disabled={disabled}
    className={`p-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:text-text/20 ${
      active
        ? "text-logo-primary hover:text-logo-primary"
        : "text-ink-3 hover:text-logo-primary"
    }`}
    title={title}
  >
    {children}
  </button>
);

const PAGE_SIZE = 30;

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
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
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

  const deleteAudioEntry = async (id: number) => {
    // Optimistically remove
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      const result = await commands.deleteHistoryEntry(id);
      if (result.status !== "ok") {
        // Reload on failure
        loadPage();
      }
    } catch (error) {
      console.error("Failed to delete entry:", error);
      loadPage();
    }
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

  if (searchResults && searchResults.length === 0) {
    content = (
      <div className="px-4 py-3 text-center text-ink-2">
        {t("settings.history.noMatches", { query: query.trim() })}
      </div>
    );
  } else if (loading) {
    content = (
      <div className="px-4 py-3 text-center text-ink-2">
        {t("settings.history.loading")}
      </div>
    );
  } else if (entries.length === 0) {
    content = (
      <div className="px-4 py-3 text-center text-ink-2">
        {t("settings.history.empty")}
      </div>
    );
  } else {
    content = (
      <>
        <AudioPlayerGroup>
          <div className="divide-y divide-line">
            {visibleEntries.map((entry) => (
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
                cancelTranscription={commands.cancelHistoryEntryTranscription}
              />
            ))}
          </div>
        </AudioPlayerGroup>
        {/* Sentinel for infinite scroll */}
        {!searchResults && <div ref={sentinelRef} className="h-1" />}
      </>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <div className="px-4 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium text-ink-3 uppercase tracking-wide">
              {t("settings.history.title")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
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
        </div>
        <label className="mx-4 flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-background focus-within:border-logo-primary">
          <Search size={16} className="text-ink-3 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.history.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <div className="bg-background border border-line rounded-lg overflow-visible">
          {content}
        </div>
      </div>
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

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  let progressText = t("settings.history.transcribing");
  if (job?.state === "queued") {
    progressText = t("settings.history.waiting");
  } else if (job?.state === "running" && job.percent > 0) {
    progressText = t("settings.history.transcribingPercent", {
      percent: job.percent,
    });
  }

  return (
    <div className="px-4 py-2 pb-5 flex flex-col gap-3">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium shrink-0">{formattedDate}</p>
          {entry.post_processed_text && (
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-logo-primary/15 text-logo-primary hover:bg-logo-primary/25 cursor-pointer"
              title={t("settings.history.toggleRawHint")}
            >
              <Sparkles size={11} />
              {showRaw
                ? t("settings.history.rawBadge")
                : t("settings.history.aiCleanedBadge")}
            </button>
          )}
          {entry.source_name && (
            <span
              className="flex items-center gap-1 min-w-0 text-sm text-ink-3"
              title={entry.source_name}
            >
              <FileAudio width={14} height={14} className="shrink-0" />
              <span className="truncate">{entry.source_name}</span>
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <IconButton
            onClick={handleToggleEdit}
            disabled={!hasTranscription || retrying}
            active={editing}
            title={t("settings.history.editAndLearn")}
          >
            <BookOpen width={16} height={16} />
          </IconButton>
          <IconButton
            onClick={handleSaveToNotes}
            disabled={!hasTranscription || retrying}
            title={t("flow.saveAsNote")}
          >
            <NotebookPen width={16} height={16} />
          </IconButton>
          <IconButton
            onClick={handleCopyText}
            disabled={!hasTranscription || retrying}
            title={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
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
            <Star
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
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
              <X width={16} height={16} />
            </IconButton>
          ) : (
            <IconButton
              onClick={() => retryTranscription(entry.id)}
              title={t("settings.history.retranscribe")}
            >
              <RotateCcw width={16} height={16} />
            </IconButton>
          )}
          <IconButton
            onClick={handleDeleteEntry}
            title={t("settings.history.delete")}
          >
            <Trash2 width={16} height={16} />
          </IconButton>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2 pb-2">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            className="w-full min-h-[72px] rounded-lg border border-line bg-background p-2.5 text-sm outline-none focus:border-logo-primary"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3">
              {t("settings.history.learnWordsHint")}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
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
        <div className="flex flex-col items-start gap-1 pb-2">
          <p
            ref={textRef}
            className={`italic text-sm w-full ${
              retrying
                ? ""
                : hasTranscription
                  ? "text-text select-text cursor-text whitespace-pre-wrap break-words"
                  : "text-ink-3"
            }`}
            style={
              retrying
                ? { animation: "transcribe-pulse 3s ease-in-out infinite" }
                : folded
                  ? {
                      display: "-webkit-box",
                      WebkitLineClamp: FOLDED_LINES,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
                  : undefined
            }
          >
            {retrying && (
              <style>{`
            @keyframes transcribe-pulse {
              0%, 100% { color: var(--color-ink-3); }
              50% { color: var(--color-text); }
            }
          `}</style>
            )}
            {retrying
              ? progressText
              : hasTranscription
                ? displayedText
                : entry.source_name
                  ? // Cancelled, interrupted by a quit, or failed.
                    t("settings.history.notTranscribed")
                  : t("settings.history.transcriptionFailed")}
          </p>
          {hasTranscription && !retrying && (expanded || overflows) && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-medium text-ink-3 hover:text-logo-primary cursor-pointer"
            >
              {expanded
                ? t("settings.history.showLess")
                : t("settings.history.showMore")}
            </button>
          )}
        </div>
      )}

      <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />
    </div>
  );
};
