import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { commands, type Note } from "@/bindings";
import { Button } from "../ui/Button";
import { SPEAKERS_TAG, renameSpeaker, speakersIn } from "./speakers";

/** Shorter recordings rarely have more than one speaker. */
const MIN_SECONDS = 10;

interface Progress {
  id: number;
  state: "running" | "done" | "failed";
  percent: number;
  speakers: number;
  error: string | null;
}

interface SpeakersPanelProps {
  note: Note;
  /** The transcript as currently edited. */
  body: string;
  onRename: (body: string, summary: string | null) => void;
}

/** Who spoke: identify the speakers in a recording, and give them names. */
export const SpeakersPanel: React.FC<SpeakersPanelProps> = ({
  note,
  body,
  onRename,
}) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [modelMb, setModelMb] = useState<number | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    commands
      .speakerModelStatus()
      .then((s) => {
        setModelReady(s.downloaded);
        setModelMb(s.size_mb);
      })
      .catch(() => setModelReady(false));
  }, []);

  useEffect(() => {
    setProgress(null);
    setEditing(null);
  }, [note.id]);

  useEffect(() => {
    const unlisten = listen<Progress>("note-speakers", (event) => {
      if (event.payload.id !== note.id) return;
      setProgress(event.payload);
      if (event.payload.state === "done") {
        if (event.payload.speakers < 2) toast.info(t("notes.speakers.single"));
        else
          toast.success(
            t("notes.speakers.found", { count: event.payload.speakers }),
          );
      } else if (event.payload.state === "failed" && event.payload.error) {
        toast.error(t("notes.speakers.failed"), {
          description: event.payload.error,
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [note.id, t]);

  const labelled = note.tags.includes(SPEAKERS_TAG);
  const speakers = labelled ? speakersIn(body) : [];
  const running = downloading || progress?.state === "running";

  if (!note.audio_file || (!labelled && note.audio_seconds < MIN_SECONDS)) {
    return null;
  }

  const identify = async () => {
    if (!modelReady) {
      setDownloading(true);
      const res = await commands.downloadSpeakerModel();
      setDownloading(false);
      if (res.status !== "ok") {
        toast.error(t("notes.speakers.downloadFailed"), {
          description: res.error,
        });
        return;
      }
      setModelReady(true);
    }
    setProgress({
      id: note.id,
      state: "running",
      percent: 0,
      speakers: 0,
      error: null,
    });
    // Progress and the result arrive as `note-speakers` events.
    await commands.labelNoteSpeakers(note.id);
  };

  const saveName = (from: string) => {
    const next = renameSpeaker(body, note.summary, from, name);
    setEditing(null);
    if (next.body !== body || next.summary !== note.summary) {
      onRename(next.body, next.summary);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <Users size={13} className="shrink-0 text-muted-foreground" />
      {running ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          {downloading
            ? t("notes.speakers.downloading")
            : t("notes.speakers.running", { percent: progress?.percent ?? 0 })}
        </span>
      ) : speakers.length > 0 ? (
        <>
          <span className="text-muted-foreground">
            {t("notes.speakers.label")}
          </span>
          {speakers.map((speaker) =>
            editing === speaker ? (
              <input
                key={speaker}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => saveName(speaker)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName(speaker);
                  if (e.key === "Escape") setEditing(null);
                }}
                aria-label={t("notes.speakers.rename", { name: speaker })}
                className="h-6 w-32 rounded-md border border-ring bg-background px-2 text-xs outline-none ring-2 ring-ring/25"
              />
            ) : (
              <button
                key={speaker}
                type="button"
                onClick={() => {
                  setEditing(speaker);
                  setName(speaker);
                }}
                title={t("notes.speakers.rename", { name: speaker })}
                className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground hover:bg-accent cursor-pointer"
              >
                {speaker}
              </button>
            ),
          )}
          <span className="text-muted-foreground">
            {t("notes.speakers.renameHint")}
          </span>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">
            {t("notes.speakers.prompt")}
          </span>
          <Button variant="primary-soft" size="sm" onClick={identify}>
            {modelReady || !modelMb
              ? t("notes.speakers.identify")
              : t("notes.speakers.identifyDownload", { size: modelMb })}
          </Button>
        </>
      )}
    </div>
  );
};
