/**
 * Lets any page send the main window to another sidebar section (and, for
 * Settings, a tab) without threading callbacks through every component.
 * App listens for the event; the Settings page reads the requested tab.
 */
export const NAVIGATE_EVENT = "utter:navigate";

export type SettingsTab = "general" | "advanced" | "about";

let pendingSettingsTab: SettingsTab | null = null;

export const navigateTo = (section: string, settingsTab?: SettingsTab) => {
  if (settingsTab) pendingSettingsTab = settingsTab;
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_EVENT, {
      detail: { section, settingsTab: settingsTab ?? null },
    }),
  );
};

/** The Settings tab another page asked for, once. */
export const takePendingSettingsTab = (): SettingsTab | null => {
  const tab = pendingSettingsTab;
  pendingSettingsTab = null;
  return tab;
};
