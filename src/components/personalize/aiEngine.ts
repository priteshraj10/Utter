import type { AppSettings, LocalAiStatus } from "@/bindings";

/**
 * Which engine handles a task. The backend tries, in order (actions.rs):
 * - dictation cleanup: the chosen provider, Apple Intelligence, built-in rules
 *   (no local model: its delay on every dictation would slow typing);
 * - notes (summaries, Ask, digests, rewrites): the provider, the local AI
 *   (Ollama), Apple Intelligence, built-in rules.
 */
export type AiEngine =
  | { kind: "provider"; label: string }
  | { kind: "local"; model: string }
  | { kind: "apple" }
  | { kind: "builtin" };

const NO_KEY_NEEDED = new Set(["apple_intelligence", "custom"]);

const configuredProvider = (
  settings: AppSettings | null | undefined,
  appleAvailable: boolean,
): AiEngine | null => {
  const id = settings?.post_process_provider_id;
  const provider = settings?.post_process_providers?.find((p) => p.id === id);
  if (!provider || !id) return null;
  if (id === "apple_intelligence")
    return appleAvailable ? { kind: "apple" } : null;
  const model = settings?.post_process_models?.[id]?.trim() ?? "";
  const key = settings?.post_process_api_keys?.[id]?.trim() ?? "";
  return model && (key || NO_KEY_NEEDED.has(id))
    ? { kind: "provider", label: provider.label }
    : null;
};

export const resolveAiEngines = (
  settings: AppSettings | null | undefined,
  appleAvailable: boolean,
  local: LocalAiStatus | null,
): { cleanup: AiEngine; notes: AiEngine } => {
  const provider = configuredProvider(settings, appleAvailable);
  const fallback: AiEngine = appleAvailable
    ? { kind: "apple" }
    : { kind: "builtin" };
  const localEngine: AiEngine | null =
    local?.running && local.model
      ? { kind: "local", model: local.model }
      : null;
  return {
    cleanup: provider ?? fallback,
    notes: provider ?? localEngine ?? fallback,
  };
};
