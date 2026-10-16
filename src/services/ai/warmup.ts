import type { ApiProvider, SettingsState } from "../../store/settingsStore";
import { getDefaultModelForProvider, reasoningFor } from "./dispatcher";
import { ANTHROPIC_ENDPOINT, anthropicHeaders, buildAnthropicPayload } from "./anthropic";
import { OPENROUTER_ENDPOINT, buildOpenRouterPayload, openRouterHeaders } from "./openrouter";
import { sentReasoning } from "./reasoning";
import { assertOk } from "./errors";
import { currentSystemParts } from "./promptTemplates";
import { isPromptCacheWarm, markPromptCache, promptCacheFingerprint } from "./promptCache";

/** The settings the warm-up reads. Callers pass the store's state at call time. */
export type WarmSettings = Pick<
  SettingsState,
  | "selectedProvider"
  | "selectedModel"
  | "apiKeys"
  | "profile"
  | "activeModeId"
  | "modes"
  | "outputLanguage"
  | "answerThinking"
  | "answerThinkingLevel"
  | "pickThinking"
>;

const GROQ_ORIGIN = "https://api.groq.com";
const ORIGINS: Partial<Record<ApiProvider, string>> = {
  openrouter: "https://openrouter.ai",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  groq: GROQ_ORIGIN,
};

const ORIGIN_GAP_MS = 30_000;
const lastHeadAt = new Map<string, number>();

/** A HEAD request opens the TLS connection before the first answer needs it. No-cors gives an opaque response, which is enough. */
function headOrigin(origin: string): void {
  const now = Date.now();
  const last = lastHeadAt.get(origin);
  if (last !== undefined && now - last < ORIGIN_GAP_MS) return;
  lastHeadAt.set(origin, now);
  void (async () => {
    await fetch(`${origin}/`, { method: "HEAD", mode: "no-cors", cache: "no-store" });
  })().catch(() => {});
}

/** Opens connections to the answer provider, and to Groq when its key is set (live options). Never throws. */
export function warmConnections(settings: WarmSettings): void {
  const origin = ORIGINS[settings.selectedProvider || "openrouter"];
  if (origin) headOrigin(origin);
  if (settings.apiKeys.groq?.trim()) headOrigin(GROQ_ORIGIN);
}

/**
 * Writes the system prompt prefix to the provider's cache with one tiny request per thinking value answers use:
 * the picks' value, and the typed and Assist value when it differs. Each one is recorded under its own
 * fingerprint, so the first answer of either kind reads the cache instead of writing it. Anthropic, direct or
 * through OpenRouter only. OpenRouter warms only with thinking off, since a thinking request capped at one
 * output token would likely be refused. Failures are ignored and not recorded.
 */
export async function warmPromptCache(settings: WarmSettings): Promise<void> {
  const provider = settings.selectedProvider || "openrouter";
  const model = settings.selectedModel || getDefaultModelForProvider(provider);
  const viaOpenRouter = provider === "openrouter" && model.startsWith("anthropic/");
  const apiKey = (settings.apiKeys[provider] || "").trim();
  if (!apiKey || (provider !== "anthropic" && !viaOpenRouter)) return;

  const { prefix, suffix } = currentSystemParts(settings);
  // Thinking is part of the cached prompt, so each value sent gets its own request; equal values share one
  const values = new Set([
    sentReasoning(provider, model, reasoningFor("option", settings)),
    sentReasoning(provider, model, reasoningFor("typed", settings)),
  ]);
  for (const reasoning of values) {
    if (viaOpenRouter && reasoning !== "none") continue;
    try {
      const fingerprint = promptCacheFingerprint(provider, model, prefix, reasoning);
      if (isPromptCacheWarm(fingerprint)) continue;

      // The same builders as a solve, so the cached system blocks match the real request byte for byte
      const request = {
        apiKey,
        model,
        prompt: ".",
        systemPrefix: prefix,
        systemSuffix: suffix,
        reasoning,
        onChunk: () => {},
      };
      const response = viaOpenRouter
        ? await fetch(OPENROUTER_ENDPOINT, {
            method: "POST",
            headers: openRouterHeaders(apiKey),
            body: JSON.stringify({ ...buildOpenRouterPayload(request), stream: false, max_tokens: 1 }),
          })
        : await fetch(ANTHROPIC_ENDPOINT, {
            method: "POST",
            headers: anthropicHeaders(apiKey),
            body: JSON.stringify({ ...buildAnthropicPayload(request), stream: false, max_tokens: 0 }),
          });
      await assertOk(response);
      await response.text();
      markPromptCache(fingerprint);
    } catch (err) {
      if (import.meta.env.DEV) console.debug("[warmup] prompt cache not warmed", err);
    }
  }
}
