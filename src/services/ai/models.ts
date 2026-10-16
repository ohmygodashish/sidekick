import type { SettingsState, SolutionProvider } from "../../store/settingsStore";

export interface ModelOption {
  id: string;
  label: string;
}

/** The answer models per provider, in picker order. The first entry is the default. */
export const SOLUTION_MODELS: Record<SolutionProvider, readonly ModelOption[]> = {
  anthropic: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  ],
  openai: [
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  ],
  openrouter: [
    { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
    { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
    { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
    { id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
    { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" },
  ],
};

/** Groq model that predicts the likely questions. Fixed: not a choice in Settings. */
export const EVALUATOR_MODEL: ModelOption = { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" };

/** The chosen model when it's listed for the provider, else the provider's default (first entry) */
export function modelFor(provider: SolutionProvider, chosen?: string): string {
  return SOLUTION_MODELS[provider].find((m) => m.id === chosen)?.id ?? SOLUTION_MODELS[provider][0].id;
}

/** The model that answers: the active provider's remembered model, validated by modelFor */
export function activeModel(settings: Pick<SettingsState, "selectedProvider" | "selectedModels">): string {
  return modelFor(settings.selectedProvider, settings.selectedModels[settings.selectedProvider]);
}
