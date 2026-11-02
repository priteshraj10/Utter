import type { Note } from "@/bindings";

/** Summary templates, matching `SUMMARY_TEMPLATES` in `src-tauri/src/utter.rs`. */
export const SUMMARY_TEMPLATES = [
  "auto",
  "meeting",
  "lecture",
  "interview",
  "one_on_one",
  "standup",
  "brainstorm",
  "action_items",
  "tldr",
  "follow_up_email",
  "journal",
] as const;

/** Note kinds, matching `managers::notes::kind`. */
export const NOTE_KINDS = ["text", "voice", "meeting", "digest"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type NoteFilter = "all" | "pinned" | NoteKind;

export const matchesFilter = (note: Note, filter: NoteFilter) =>
  filter === "all"
    ? true
    : filter === "pinned"
      ? note.pinned
      : note.kind === filter;

/** Where in a note an action item lives. */
export type ActionField = "summary" | "body";

export interface ActionItem {
  noteId: number;
  noteTitle: string;
  field: ActionField;
  /** Line index within the field. */
  line: number;
  text: string;
  done: boolean;
}

const CHECKBOX_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+)$/;

/** Every Markdown checkbox (`- [ ] ...`) in a note's summary and body. */
export const parseActionItems = (note: Note): ActionItem[] => {
  const items: ActionItem[] = [];
  const scan = (field: ActionField, text: string | null) => {
    if (!text) return;
    text.split("\n").forEach((raw, line) => {
      const m = CHECKBOX_LINE.exec(raw);
      if (m) {
        items.push({
          noteId: note.id,
          noteTitle: note.title,
          field,
          line,
          text: m[4].trim(),
          done: m[2].toLowerCase() === "x",
        });
      }
    });
  };
  scan("summary", note.summary);
  scan("body", note.body);
  return items;
};

/** `text` with the checkbox on `line` ticked or unticked. */
export const toggleCheckboxLine = (
  text: string,
  line: number,
  done: boolean,
): string => {
  const lines = text.split("\n");
  const m = CHECKBOX_LINE.exec(lines[line] ?? "");
  if (!m) return text;
  lines[line] = `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}`;
  return lines.join("\n");
};

/** A note as a Markdown document, for copying into other apps. */
export const noteToMarkdown = (
  note: Note,
  draft: { title: string; body: string },
  labels: { untitled: string; summary: string; transcript: string },
): string => {
  const parts = [`# ${draft.title.trim() || labels.untitled}`];
  if (note.tags.length > 0) {
    parts.push(note.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" "));
  }
  if (note.summary?.trim()) {
    parts.push(`## ${labels.summary}\n\n${note.summary.trim()}`);
  }
  if (draft.body.trim()) {
    parts.push(`## ${labels.transcript}\n\n${draft.body.trim()}`);
  }
  return parts.join("\n\n") + "\n";
};

export const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${m.toString().padStart(h > 0 ? 2 : 1, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
};
