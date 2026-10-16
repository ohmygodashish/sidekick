import type { ApiProvider, SettingsState, ThinkingLevel } from "../../store/settingsStore";
import type { MessageKind, ProgressiveSolution } from "../../store/sessionStore";
import { parseProgressiveStream } from "./streamParser";
import { ProviderHttpError } from "./errors";
import { streamOpenRouter, type ReasoningMode } from "./openrouter";
import { streamAnthropic } from "./anthropic";
import { streamOpenAI } from "./openai";
import { markPromptCache, promptCacheFingerprint } from "./promptCache";
import { sentReasoning } from "./reasoning";

export interface DispatchOptions {
  provider: ApiProvider;
  apiKey?: string;
  model?: string;
  prompt: string;
  /** The whole system prompt, used when systemPrefix isn't given */
  systemPrompt?: string;
  /** Stable, cacheable start of the system prompt; with systemSuffix it replaces systemPrompt */
  systemPrefix?: string;
  systemSuffix?: string;
  /** "none" turns thinking off for this answer; low, medium and high set its effort. See reasoningFor and sentReasoning */
  reasoning: ReasoningMode;
  imageBase64?: string;
  imageMimeType?: string;
  questionId?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onProgressiveUpdate?: (solution: ProgressiveSolution) => void;
}

const LEVELS: readonly string[] = ["low", "medium", "high"];

/**
 * Thinking for one answer. Typed questions and Assist follow the thinking switch. Option picks and the
 * slot-1 prefetch also need the picks switch, so they stay fast unless the user asks otherwise.
 */
export function reasoningFor(
  kind: MessageKind,
  settings: Pick<SettingsState, "answerThinking" | "answerThinkingLevel" | "pickThinking">
): ReasoningMode {
  if (!settings.answerThinking) return "none";
  // A level that isn't one of the three (a hand-edited config) falls back to the default
  const level: ThinkingLevel = LEVELS.includes(settings.answerThinkingLevel) ? settings.answerThinkingLevel : "medium";
  if (kind !== "option") return level;
  return settings.pickThinking ? level : "none";
}

/** MIME type of a `data:image/...;base64,` URL from the capture; PNG when there is none. */
export function mimeTypeOfDataUrl(dataUrl: string): string {
  return /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(dataUrl)?.[1]?.toLowerCase() ?? "image/png";
}

// Long enough for a slow model to start, short enough that a dead connection doesn't hang the panel
const STALL_TIMEOUT_MS = 25_000;
const STALL_MESSAGE = "The model stopped responding. Retry, or pick a faster model in Settings.";
const EMPTY_MESSAGE = "The model returned an empty answer. Retry, or pick another model in Settings.";

const PROVIDER_NAMES: Record<ApiProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  groq: "Groq",
};

/**
 * Returns canonical default model identifier for each supported provider.
 */
export function getDefaultModelForProvider(provider: ApiProvider): string {
  switch (provider) {
    case "openrouter":
      return "anthropic/claude-haiku-5.5";
    case "anthropic":
      return "claude-haiku-5-5";
    case "openai":
      return "gpt-5.6-luna";
    case "groq":
      return "openai/gpt-oss-120b";
    default:
      return "anthropic/claude-haiku-5.5";
  }
}

function hasAnswer(solution: ProgressiveSolution): boolean {
  return Boolean(
    solution.stage1Intuition?.verbalSummary ||
      solution.stage1Intuition?.keyTradeoffs.length ||
      solution.stage2Code?.code ||
      solution.stage3Analysis?.timeComplexity ||
      solution.stage3Analysis?.spaceComplexity ||
      solution.stage3Analysis?.edgeCases.length
  );
}

/** A 400 whose body names the thinking setting: the provider refused it, so the request can go without it */
function refusesThinking(err: unknown): boolean {
  return err instanceof ProviderHttpError && err.status === 400 && /reasoning|effort|thinking/i.test(err.body);
}

/**
 * Maps a provider failure to a short message for the answer panel. The raw error stays on `cause`.
 */
function toUserError(err: unknown, provider: ApiProvider, model: string, gotData: boolean): Error {
  const name = PROVIDER_NAMES[provider];
  let message = `${name} request failed. Retry in a moment.`;

  if (err instanceof ProviderHttpError) {
    const { status, body } = err;
    if (status === 401 || status === 403) {
      message = `${name} rejected the API key. Check it in Settings → Keys.`;
    } else if (status === 404 || (status === 400 && /model/i.test(body) && !/context/i.test(body))) {
      message = `${name} doesn't recognise the model "${model}". Pick another in Settings.`;
    } else if (status === 429) {
      message = `${name} is rate-limiting requests. Wait a moment, then retry.`;
    } else if (status >= 500) {
      message = `${name} is having problems (HTTP ${status}). Retry in a moment.`;
    } else {
      message = `${name} returned HTTP ${status}.`;
    }
  } else if (err instanceof TypeError && !gotData) {
    // fetch rejects with a TypeError when the network is unreachable; later ones are our bugs
    message = `Couldn't reach ${name}. Check your connection.`;
  }

  console.warn(`[DeepSolver Dispatcher] ${name} request failed:`, err);
  return Object.assign(new Error(message), { cause: err });
}

/**
 * Dispatches a Deep Solve request to the configured AI provider with progressive updates.
 * Throws on a missing key, provider failure, stall or empty answer; never substitutes a canned answer.
 */
export async function dispatchDeepSolve(
  options: DispatchOptions
): Promise<ProgressiveSolution> {
  const {
    provider,
    apiKey,
    model: requestedModel,
    prompt,
    systemPrompt,
    systemPrefix,
    systemSuffix,
    reasoning,
    imageBase64,
    imageMimeType,
    questionId,
    signal,
    onChunk,
    onProgressiveUpdate,
  } = options;

  const model = requestedModel || getDefaultModelForProvider(provider);
  const metadata = { questionId, provider, model };

  const trimmedKey = (apiKey || "").trim();
  if (!trimmedKey) {
    throw new Error(`Add your ${PROVIDER_NAMES[provider]} API key in Settings → Keys.`);
  }

  // The thinking value the request sends (undefined: none). A retry without it changes the cached shape too.
  let sent = sentReasoning(provider, model, reasoning);
  // Recorded on the first text chunk, so a request that fails or stalls before answering doesn't count as cached
  let cacheKey = systemPrefix ? promptCacheFingerprint(provider, model, systemPrefix, sent) : undefined;

  const startedAt = performance.now();
  let firstTokenAt: number | undefined;

  // The stall timer aborts through this controller, so the caller's signal is linked to it
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort);
  if (signal?.aborted) controller.abort();

  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const resetStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, STALL_TIMEOUT_MS);
  };

  let accumulated = "";
  const handleChunk = (chunk: string) => {
    resetStallTimer();
    if (chunk && firstTokenAt === undefined) {
      firstTokenAt = performance.now();
      // Text arrived, so the provider accepted the request and wrote this prefix to its cache
      if (cacheKey) markPromptCache(cacheKey);
    }
    accumulated += chunk;
    onChunk?.(chunk);
    if (onProgressiveUpdate) {
      onProgressiveUpdate(parseProgressiveStream(accumulated, metadata));
    }
  };

  const send = async (thinking: ReasoningMode | undefined) => {
    const req = {
      apiKey: trimmedKey,
      model,
      prompt,
      systemPrompt,
      systemPrefix,
      systemSuffix,
      reasoning: thinking,
      imageBase64,
      imageMimeType,
      signal: controller.signal,
      onChunk: handleChunk,
      onActivity: resetStallTimer,
    };
    switch (provider) {
      case "openrouter":
        await streamOpenRouter(req);
        break;
      case "anthropic":
        await streamAnthropic(req);
        break;
      case "openai":
        await streamOpenAI(req);
        break;
      case "groq":
        await streamOpenAI({
          ...req,
          endpoint: "https://api.groq.com/openai/v1/chat/completions",
        });
        break;
      default:
        await streamOpenRouter(req);
        break;
    }
  };

  resetStallTimer();
  try {
    try {
      await send(reasoning);
    } catch (err) {
      // Last resort: a 400 that names the thinking setting is retried once with the model's default
      if (sent === undefined || accumulated || signal?.aborted || !refusesThinking(err)) throw err;
      sent = undefined;
      cacheKey = systemPrefix ? promptCacheFingerprint(provider, model, systemPrefix, undefined) : undefined;
      // The retry gets its own stall window, not the time the refused attempt already used
      resetStallTimer();
      await send(undefined);
    }
  } catch (err) {
    // A user cancel must reach the caller unchanged so it can ignore it
    if (signal?.aborted) throw err;
    if (stalled) throw Object.assign(new Error(STALL_MESSAGE), { cause: err });
    throw toUserError(err, provider, model, accumulated.length > 0);
  } finally {
    clearTimeout(stallTimer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  // Stream readers can return quietly after an abort instead of throwing
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  if (stalled) throw new Error(STALL_MESSAGE);

  const solution = parseProgressiveStream(accumulated, metadata);
  if (!hasAnswer(solution)) throw new Error(EMPTY_MESSAGE);
  if (import.meta.env.DEV) {
    console.debug("[latency]", {
      provider,
      model,
      reasoning: sent ?? "default",
      ttftMs: firstTokenAt === undefined ? null : Math.round(firstTokenAt - startedAt),
      totalMs: Math.round(performance.now() - startedAt),
    });
  }
  return solution;
}
