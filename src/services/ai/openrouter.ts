import { readSSEStream } from "./streamParser";
import { assertOk } from "./errors";
import { isOpenAIReasoningModel, reasoningSupport, sentReasoning } from "./reasoning";

/** "none" turns thinking off for this answer; low, medium and high set its effort. Models without one get no fields (see reasoning.ts). */
export type ReasoningMode = "none" | "low" | "medium" | "high";

export interface ProviderStreamRequest {
  apiKey: string;
  model?: string;
  prompt: string;
  /** The whole system prompt; used when no prefix is given */
  systemPrompt?: string;
  /** The stable, cacheable start of the system prompt. When set, providers that cache put a breakpoint after it */
  systemPrefix?: string;
  /** The rest of the system prompt after the prefix (mode, language); may be empty */
  systemSuffix?: string;
  reasoning?: ReasoningMode;
  imageBase64?: string;
  imageMimeType?: string;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
  /** Called on every read from the stream, keep-alives and reasoning included */
  onActivity?: () => void;
  endpoint?: string;
}

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/sidekick/sidekick",
    "X-Title": "Sidekick Desktop Copilot",
  };
}

/**
 * Strips data URI prefix if present to yield raw base64 string.
 */
export function cleanBase64Data(raw: string): string {
  if (raw.startsWith("data:")) {
    const commaIndex = raw.indexOf(",");
    if (commaIndex !== -1) {
      return raw.slice(commaIndex + 1);
    }
  }
  return raw;
}

/** The system prompt as one string (prefix plus suffix when the parts are given). OpenAI caches the prefix itself. */
export function systemText(request: ProviderStreamRequest): string | undefined {
  if (request.systemPrefix) return request.systemPrefix + (request.systemSuffix ?? "");
  return request.systemPrompt;
}

/**
 * OpenRouter system content: a plain string, except for Anthropic and Google models, which get a text part
 * with a cache marker on the prefix (1 hour for Anthropic).
 */
function openRouterSystem(request: ProviderStreamRequest, model: string): string | Array<Record<string, unknown>> {
  const prefix = request.systemPrefix ?? "";
  const suffix = request.systemSuffix ?? "";
  let cacheControl: Record<string, string> | undefined;
  if (model.startsWith("anthropic/")) cacheControl = { type: "ephemeral", ttl: "1h" };
  else if (model.startsWith("google/")) cacheControl = { type: "ephemeral" };
  if (!cacheControl) return prefix + suffix;
  return [
    { type: "text", text: prefix, cache_control: cacheControl },
    ...(suffix ? [{ type: "text", text: suffix }] : []),
  ];
}

/**
 * Builds OpenRouter Chat Completion payload matching OpenAI vision spec.
 */
export function buildOpenRouterPayload(request: ProviderStreamRequest) {
  const model = request.model || "anthropic/claude-haiku-5.5";
  const anthropic = model.startsWith("anthropic/");
  const openAIReasoning = isOpenAIReasoningModel(model);
  // Models that take a thinking setting get the Claude output room; older Claude ids keep the shorter cap
  const roomy = reasoningSupport("openrouter", model).supported || openAIReasoning;
  const messages: Array<{ role: string; content: any }> = [];

  if (request.systemPrefix) {
    messages.push({
      role: "system",
      content: openRouterSystem(request, model),
    });
  } else if (request.systemPrompt) {
    messages.push({
      role: "system",
      content: request.systemPrompt,
    });
  }

  if (request.imageBase64) {
    const mimeType = request.imageMimeType || "image/png";
    const cleaned = cleanBase64Data(request.imageBase64);
    const dataUri = `data:${mimeType};base64,${cleaned}`;

    messages.push({
      role: "user",
      content: [
        { type: "text", text: request.prompt },
        {
          type: "image_url",
          image_url: { url: dataUri },
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: request.prompt,
    });
  }

  const payload: Record<string, any> = {
    model,
    stream: true,
    messages,
    // Room for thinking at high effort plus the answer; other models keep a cap they all accept
    max_tokens: roomy ? 16000 : 4096,
  };
  // Claude takes only its default temperature, and OpenAI reasoning models reject one
  if (!anthropic && !openAIReasoning) payload.temperature = 0.2;
  const thinking = sentReasoning("openrouter", model, request.reasoning);
  if (thinking) payload.reasoning = { effort: thinking };
  return payload;
}

/**
 * Streams tokens from OpenRouter API using Server-Sent Events (REQ-014).
 */
export async function streamOpenRouter(
  request: ProviderStreamRequest
): Promise<string> {
  const endpoint = request.endpoint || OPENROUTER_ENDPOINT;
  const payload = buildOpenRouterPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: openRouterHeaders(request.apiKey),
    body: JSON.stringify(payload),
    signal: request.signal,
  });

  await assertOk(response);

  let accumulated = "";

  await readSSEStream(
    response,
    (line) => {
      if (!line.startsWith("data:")) return;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") return;

      try {
        const json = JSON.parse(dataStr);
        // Usage arrives on a final chunk when the provider reports it
        if (import.meta.env.DEV && json.usage) console.debug("[latency] openrouter usage", json.usage);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          request.onChunk(delta);
        }
      } catch {
        // Partial or malformed SSE line, ignore
      }
    },
    request.signal,
    request.onActivity
  );

  return accumulated;
}
