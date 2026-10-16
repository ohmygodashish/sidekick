import { readSSEStream } from "./streamParser";
import { assertOk } from "./errors";

export interface ProviderStreamRequest {
  apiKey: string;
  model?: string;
  prompt: string;
  systemPrompt?: string;
  imageBase64?: string;
  imageMimeType?: string;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
  /** Called on every read from the stream, keep-alives and reasoning included */
  onActivity?: () => void;
  endpoint?: string;
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

/**
 * Builds OpenRouter Chat Completion payload matching OpenAI vision spec.
 */
export function buildOpenRouterPayload(request: ProviderStreamRequest) {
  const model = request.model || "anthropic/claude-haiku-5.5";
  const messages: Array<{ role: string; content: any }> = [];

  if (request.systemPrompt) {
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

  return {
    model,
    stream: true,
    messages,
    temperature: 0.2,
    max_tokens: 4096,
  };
}

/**
 * Streams tokens from OpenRouter API using Server-Sent Events (REQ-014).
 */
export async function streamOpenRouter(
  request: ProviderStreamRequest
): Promise<string> {
  const endpoint = request.endpoint || "https://openrouter.ai/api/v1/chat/completions";
  const payload = buildOpenRouterPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/sidekick/sidekick",
      "X-Title": "Sidekick Desktop Copilot",
    },
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
