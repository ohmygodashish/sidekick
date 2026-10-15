import { readSSEStream } from "./streamParser";
import { cleanBase64Data, ProviderStreamRequest } from "./openrouter";

/**
 * Builds Anthropic Messages API payload with image content block.
 */
export function buildAnthropicPayload(request: ProviderStreamRequest) {
  let model = request.model || "claude-3-5-sonnet-20241022";
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
    max_tokens: 4096,
    stream: true,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  if (request.systemPrompt) {
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
  const endpoint = request.endpoint || "https://api.anthropic.com/v1/messages";
  const payload = buildAnthropicPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": request.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: request.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Anthropic HTTP ${response.status} ${response.statusText}: ${errorBody}`
    );
  }

  let accumulated = "";

  await readSSEStream(
    response,
    (line) => {
      if (!line.startsWith("data:")) return;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") return;

      try {
        const json = JSON.parse(dataStr);
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
    request.signal
  );

  return accumulated;
}
