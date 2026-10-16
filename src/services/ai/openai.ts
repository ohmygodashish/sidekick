import { readSSEStream } from "./streamParser";
import { assertOk } from "./errors";
import { cleanBase64Data, ProviderStreamRequest } from "./openrouter";

/**
 * Builds OpenAI Chat Completions payload with vision image_url support.
 */
export function buildOpenAIPayload(request: ProviderStreamRequest) {
  let model = request.model || "gpt-5.6-luna";
  // Only OpenAI's own endpoint drops the prefix; Groq's ids include it (openai/gpt-oss-120b)
  if (!request.endpoint && model.startsWith("openai/")) {
    model = model.slice("openai/".length);
  }

  // o-series and GPT-5 models reject temperature and max_tokens
  const isReasoningModel = /^(o\d|gpt-5)/i.test(model);
  const messages: Array<{ role: string; content: any }> = [];

  if (request.systemPrompt) {
    messages.push({
      role: isReasoningModel ? "developer" : "system",
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
  };

  if (isReasoningModel) {
    payload.max_completion_tokens = 4096;
  } else {
    payload.temperature = 0.2;
    payload.max_tokens = 4096;
  }

  return payload;
}

/**
 * Streams tokens from OpenAI Chat Completions API using Server-Sent Events (REQ-014).
 */
export async function streamOpenAI(
  request: ProviderStreamRequest
): Promise<string> {
  const endpoint = request.endpoint || "https://api.openai.com/v1/chat/completions";
  const payload = buildOpenAIPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey.trim()}`,
      "Content-Type": "application/json",
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
        if (typeof delta === "string") {
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
