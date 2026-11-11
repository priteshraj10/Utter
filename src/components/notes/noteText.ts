import type { Note } from "@/bindings";

/** A one-glance preview of note text: markdown syntax and headings removed. */
export const plainPreview = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) =>
      line
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .replace(/\*\*|__|`/g, ""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Writing systems a speech model can wrongly switch into, with the spoken
 * languages that legitimately use them. */
const SCRIPTS: { pattern: RegExp; languages: string[] }[] = [
  { pattern: /[ऀ-ॿ]/g, languages: ["hi", "mr", "ne", "sa"] },
  { pattern: /[؀-ۿ]/g, languages: ["ar", "fa", "ur"] },
  { pattern: /[Ѐ-ӿ]/g, languages: ["ru", "uk", "bg", "sr"] },
];

/**
 * A recorded note whose transcript is mostly in a script none of the user's
 * languages use: almost always the model guessing the wrong language.
 */
export const looksMistranscribed = (
  note: Note,
  spokenLanguages: string[],
): boolean => {
  if (!note.audio_file) return false;
  const letters = note.body.replace(/[^\p{L}]/gu, "");
  if (letters.length < 8) return false;
  const spoken = spokenLanguages.map((l) => l.split("-")[0].toLowerCase());
  return SCRIPTS.some(({ pattern, languages }) => {
    if (languages.some((l) => spoken.includes(l))) return false;
    const count = letters.match(pattern)?.length ?? 0;
    return count / letters.length > 0.5;
  });
};
