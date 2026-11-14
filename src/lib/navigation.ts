/**
 * Lets any page send the main window to another sidebar section (and, for
 * Settings, a tab) without threading callbacks through every component.
 * App listens for the event; the Settings page reads the requested tab.
 */
export const NAVIGATE_EVENT = "utter:navigate";

export type SettingsTab = "general" | "advanced" | "about";
export type NotesTab = "notes" | "ask" | "actions";

let pendingSettingsTab: SettingsTab | null = null;
let pendingNotesTab: NotesTab | null = null;
let pendingNoteId: number | null = null;

export const navigateTo = (
  section: string,
  settingsTab?: SettingsTab,
  notesTab?: NotesTab,
  noteId?: number,
) => {
  if (settingsTab) pendingSettingsTab = settingsTab;
  if (notesTab) pendingNotesTab = notesTab;
  if (noteId != null) pendingNoteId = noteId;
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_EVENT, {
      detail: {
        section,
        settingsTab: settingsTab ?? null,
        notesTab: notesTab ?? null,
        noteId: noteId ?? null,
      },
    }),
  );
};

/** The Settings tab another page asked for, once. */
export const takePendingSettingsTab = (): SettingsTab | null => {
  const tab = pendingSettingsTab;
  pendingSettingsTab = null;
  return tab;
};

/** The Notes tab another page asked for, once. */
export const takePendingNotesTab = (): NotesTab | null => {
  const tab = pendingNotesTab;
  pendingNotesTab = null;
  return tab;
};

/** The Note ID another page asked to open, once. */
export const takePendingNoteId = (): number | null => {
  const id = pendingNoteId;
  pendingNoteId = null;
  return id;
};
