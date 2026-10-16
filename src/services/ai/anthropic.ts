import { readSSEStream } from "./streamParser";
import { assertOk } from "./errors";
import { cleanBase64Data, ProviderStreamRequest, type ReasoningMode } from "./openrouter";
import { reasoningSupport, sentReasoning } from "./reasoning";

export const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface ClaudeThinkingParams {
  max_tokens: number;
  thinking?: { type: "disabled" };
  output_config?: { effort: "low" | "medium" | "high" };
}

/**
 * The thinking fields and output room for one Claude model. A model without an effort setting gets neither, so
 * an unknown id still works. Thinking is left to the model when no reasoning is given, or when the model
 * can't turn it off.
 */
export function claudeThinkingParams(model: string, reasoning?: ReasoningMode): ClaudeThinkingParams {
  if (!reasoningSupport("anthropic", model).supported) return { max_tokens: 4096 };
  // Room for thinking at high effort plus the answer
  const maxTokens = 16000;
  const thinking = sentReasoning("anthropic", model, reasoning);
  if (!thinking) return { max_tokens: maxTokens };
  if (thinking !== "none") return { max_tokens: maxTokens, output_config: { effort: thinking } };
  return { max_tokens: maxTokens, thinking: { type: "disabled" } };
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey.trim(),
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "Content-Type": "application/json",
  };
}

/**
 * Builds Anthropic Messages API payload with image content block.
 */
export function buildAnthropicPayload(request: ProviderStreamRequest) {
  let model = request.model || "claude-haiku-5-5";
  // If model was prefixed with "anthropic/", strip it
  if (model.startsWith("anthropic/")) {
    model = model.slice("anthropic/".length);
  }

  let userContent: any;

  if (request.imageBase64) {
    const mediaType = (request.imageMimeType || "image/png") as
      | "image/png"
      | "image/jpeg"
      | "image/webp"
      | "image/gif";
    const cleaned = cleanBase64Data(request.imageBase64);

    userContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: cleaned,
        },
      },
      {
        type: "text",
        text: request.prompt,
      },
    ];
  } else {
    userContent = request.prompt;
  }

  const payload: Record<string, any> = {
    model,
    stream: true,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
    ...claudeThinkingParams(model, request.reasoning),
  };

  if (request.systemPrefix) {
    // The prefix is the cached block (1 hour); the mode and language after it are not cached
    payload.system = [
      { type: "text", text: request.systemPrefix, cache_control: { type: "ephemeral", ttl: "1h" } },
      ...(request.systemSuffix ? [{ type: "text", text: request.systemSuffix }] : []),
    ];
  } else if (request.systemPrompt) {
    payload.system = request.systemPrompt;
  }

  return payload;
}

/**
 * Streams tokens from Anthropic Messages API using Server-Sent Events (REQ-014).
 */
export async function streamAnthropic(
  request: ProviderStreamRequest
): Promise<string> {
  const endpoint = request.endpoint || ANTHROPIC_ENDPOINT;
  const payload = buildAnthropicPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: anthropicHeaders(request.apiKey),
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
        // message_start carries this request's cache counters (cache_read / cache_creation input tokens)
        if (import.meta.env.DEV && json.type === "message_start") {
          console.debug("[latency] anthropic usage", json.message?.usage);
        }
        // Anthropic content_block_delta format: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
        const text = json.delta?.text;
        if (typeof text === "string") {
          accumulated += text;
          request.onChunk(text);
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
