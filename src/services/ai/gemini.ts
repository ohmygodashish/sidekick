import { readSSEStream } from "./streamParser";
import { cleanBase64Data, ProviderStreamRequest } from "./openrouter";

/**
 * Builds Google Gemini API payload with inlineData vision support.
 */
export function buildGeminiPayload(request: ProviderStreamRequest) {
  const parts: Array<Record<string, any>> = [];

  if (request.imageBase64) {
    const mimeType = request.imageMimeType || "image/png";
    const cleaned = cleanBase64Data(request.imageBase64);

    parts.push({
      inlineData: {
        mimeType,
        data: cleaned,
      },
    });
  }

  parts.push({
    text: request.prompt,
  });

  const payload: Record<string, any> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  };

  if (request.systemPrompt) {
    payload.systemInstruction = {
      parts: [
        {
          text: request.systemPrompt,
        },
      ],
    };
  }

  return payload;
}

/**
 * Resolves the clean Gemini model string.
 */
export function getGeminiModel(model?: string): string {
  let m = model || "gemini-2.0-flash";
  if (m.startsWith("google/") || m.startsWith("gemini/")) {
    m = m.replace(/^(google|gemini)\//, "");
  }
  return m;
}

/**
 * Streams tokens from Google Gemini API using Server-Sent Events (REQ-014).
 */
export async function streamGemini(
  request: ProviderStreamRequest
): Promise<string> {
  const model = getGeminiModel(request.model);
  const endpoint =
    request.endpoint ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      request.apiKey.trim()
    )}`;
  const payload = buildGeminiPayload(request);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: request.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Gemini HTTP ${response.status} ${response.statusText}: ${errorBody}`
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
        // Gemini SSE format: candidates[0].content.parts[0].text
        const textParts = json.candidates?.[0]?.content?.parts;
        if (Array.isArray(textParts)) {
          for (const part of textParts) {
            if (part && typeof part.text === "string") {
              accumulated += part.text;
              request.onChunk(part.text);
            }
          }
        }
      } catch {
        // Partial or malformed SSE line, ignore
      }
    },
    request.signal
  );

  return accumulated;
}
