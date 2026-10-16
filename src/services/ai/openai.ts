import { readSSEStream } from "./streamParser";
import { assertOk } from "./errors";
import { cleanBase64Data, ProviderStreamRequest, systemText } from "./openrouter";
import { isOpenAIReasoningModel, sentReasoning } from "./reasoning";

/**
 * Builds OpenAI Chat Completions payload with vision image_url support.
 */
export function buildOpenAIPayload(request: ProviderStreamRequest) {
  let model = request.model || "gpt-6-luna";
  // Only OpenAI's own endpoint drops the prefix; Groq's ids include it (openai/gpt-oss-120b)
  if (!request.endpoint && model.startsWith("openai/")) {
    model = model.slice("openai/".length);
  }

  // GPT-5 and later and o-series models reason: they reject temperature and max_tokens
  const isReasoningModel = isOpenAIReasoningModel(model);
  const messages: Array<{ role: string; content: any }> = [];

  // One stable string: OpenAI caches the repeated prefix automatically
  const system = systemText(request);
  if (system) {
    messages.push({
      role: isReasoningModel ? "developer" : "system",
      content: system,
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
    // Room for thinking at high effort plus the answer, as for Claude
    payload.max_completion_tokens = 16000;
    const thinking = sentReasoning("openai", model, request.reasoning);
    if (thinking) payload.reasoning_effort = thinking;
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
