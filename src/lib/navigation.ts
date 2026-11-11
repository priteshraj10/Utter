/**
 * Lets any page send the main window to another sidebar section without
 * threading callbacks through every component. App listens for it.
 */
export const NAVIGATE_EVENT = "utter:navigate";

export const navigateTo = (section: string) => {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: section }));
};
