/** Tag the backend adds once a note's transcript is labelled by speaker (speakers.rs). */
export const SPEAKERS_TAG = "speakers";

/** A label is what precedes ": " at the start of a paragraph, kept short. */
const LABEL = /^([^\n:]{1,40}):\s/;

const paragraphs = (body: string) =>
  body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** The speakers of a labelled transcript, in order of first appearance. */
export const speakersIn = (body: string): string[] => {
  const seen: string[] = [];
  for (const paragraph of paragraphs(body)) {
    const label = LABEL.exec(paragraph)?.[1]?.trim();
    if (label && !seen.includes(label)) seen.push(label);
  }
  return seen;
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Renames a speaker everywhere: the paragraph labels in the transcript, and
 * mentions in the summary (which the AI writes as "Speaker 1 will …").
 */
export const renameSpeaker = (
  body: string,
  summary: string | null,
  from: string,
  to: string,
): { body: string; summary: string | null } => {
  const name = to.replace(/[:\n]/g, " ").trim();
  if (!name || name === from) return { body, summary };
  const label = new RegExp(`^(\\s*)${escapeRegExp(from)}:`, "gm");
  const mention = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
  return {
    body: body.replace(label, `$1${name}:`),
    summary: summary ? summary.replace(mention, name) : summary,
  };
};
