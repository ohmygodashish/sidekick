import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAnthropicPayload, claudeThinkingParams, type ClaudeThinkingParams } from "../services/ai/anthropic";
import { buildOpenRouterPayload, ProviderStreamRequest, type ReasoningMode } from "../services/ai/openrouter";
import { buildOpenAIPayload } from "../services/ai/openai";
import { dispatchDeepSolve } from "../services/ai/dispatcher";
import { fetchLiveOptions } from "../services/ai/liveOptions";

const CACHE_1H = { type: "ephemeral", ttl: "1h" };

function request(over: Partial<ProviderStreamRequest> = {}): ProviderStreamRequest {
  return { apiKey: "key", prompt: "Two sum", onChunk: () => {}, ...over };
}

describe("Anthropic payload", () => {
  it("sends the system prompt as a plain string, with no cache marker, when no prefix is given", () => {
    const payload = buildAnthropicPayload(request({ systemPrompt: "Be brief." }));

    expect(payload.system).toBe("Be brief.");
    expect(JSON.stringify(payload)).not.toContain("cache_control");
  });

  it("caches the prefix for an hour and sends the suffix as an uncached block", () => {
    const payload = buildAnthropicPayload(request({ systemPrefix: "PROFILE", systemSuffix: "\n### MODE\nSTAR" }));

    expect(payload.system).toEqual([
      { type: "text", text: "PROFILE", cache_control: CACHE_1H },
      { type: "text", text: "\n### MODE\nSTAR" },
    ]);
  });

  it("leaves out the suffix block when the suffix is empty", () => {
    const payload = buildAnthropicPayload(request({ systemPrefix: "PROFILE", systemSuffix: "" }));

    expect(payload.system).toEqual([{ type: "text", text: "PROFILE", cache_control: CACHE_1H }]);
  });

  it("turns thinking off for none, and sets the effort for low, medium and high", () => {
    const none = buildAnthropicPayload(request({ reasoning: "none" }));
    expect(none.thinking).toEqual({ type: "disabled" });
    expect(none).not.toHaveProperty("output_config");

    for (const effort of ["low", "medium", "high"] as const) {
      const payload = buildAnthropicPayload(request({ reasoning: effort }));
      expect(payload.output_config).toEqual({ effort });
      expect(payload).not.toHaveProperty("thinking");
    }
  });

  it("leaves thinking to the model when no reasoning is given", () => {
    const payload = buildAnthropicPayload(request());
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("output_config");
  });
});

describe("Claude thinking fields", () => {
  const cases: [string, ReasoningMode | undefined, ClaudeThinkingParams][] = [
    // Models with an effort setting: thinking off, or the effort, with room for the answer
    ["claude-haiku-5-5", "none", { max_tokens: 16000, thinking: { type: "disabled" } }],
    ["claude-haiku-5-5", "low", { max_tokens: 16000, output_config: { effort: "low" } }],
    ["claude-haiku-5-5", "medium", { max_tokens: 16000, output_config: { effort: "medium" } }],
    ["claude-haiku-5-5", "high", { max_tokens: 16000, output_config: { effort: "high" } }],
    ["claude-sonnet-4-6", "none", { max_tokens: 16000, thinking: { type: "disabled" } }],
    ["claude-opus-4-8", "none", { max_tokens: 16000, thinking: { type: "disabled" } }],
    ["claude-opus-4-5", "high", { max_tokens: 16000, output_config: { effort: "high" } }],
    // Models that reject thinking switched off: "none" sends nothing, so the model uses its default
    ["claude-opus-5-5", "none", { max_tokens: 16000 }],
    ["claude-opus-5-5", "low", { max_tokens: 16000, output_config: { effort: "low" } }],
    ["claude-fable-1", "none", { max_tokens: 16000 }],
    ["claude-mythos-1", "none", { max_tokens: 16000 }],
    ["claude-fable-1", "high", { max_tokens: 16000, output_config: { effort: "high" } }],
    // Sonnet 5.5 takes between_tools for "none"
    ["claude-sonnet-5-5", "none", { max_tokens: 16000, thinking: { type: "between_tools" } }],
    ["claude-sonnet-5.5", "none", { max_tokens: 16000, thinking: { type: "between_tools" } }],
    ["claude-sonnet-5-5", "low", { max_tokens: 16000, output_config: { effort: "low" } }],
    // No reasoning given: the model's own default, no thinking fields
    ["claude-haiku-5-5", undefined, { max_tokens: 16000 }],
    // Other ids get no thinking fields and the shorter output cap
    ["claude-3-5-sonnet-20241022", "none", { max_tokens: 4096 }],
    ["claude-3-5-sonnet-20241022", "high", { max_tokens: 4096 }],
    ["claude-opus-4-4", "medium", { max_tokens: 4096 }],
    ["gpt-4o", "none", { max_tokens: 4096 }],
  ];

  it.each(cases)("%s with reasoning %s", (model, reasoning, expected) => {
    expect(claudeThinkingParams(model, reasoning)).toEqual(expected);
  });

  it("reaches the Anthropic payload through the model id, with the provider prefix stripped", () => {
    const payload = buildAnthropicPayload(request({ model: "anthropic/claude-haiku-5.5", reasoning: "high" }));

    expect(payload).toMatchObject({ model: "claude-haiku-5.5", max_tokens: 16000, output_config: { effort: "high" } });
    expect(payload).not.toHaveProperty("thinking");
  });

  it("sends an unknown Claude model no thinking fields, whatever the level", () => {
    const payload = buildAnthropicPayload(request({ model: "claude-3-5-sonnet-20241022", reasoning: "high" }));

    expect(payload.max_tokens).toBe(4096);
    expect(payload).not.toHaveProperty("output_config");
    expect(payload).not.toHaveProperty("thinking");
  });
});

describe("OpenRouter payload", () => {
  it("marks an Anthropic prefix with a one-hour TTL and drops temperature", () => {
    const payload = buildOpenRouterPayload(
      request({ model: "anthropic/claude-haiku-5.5", systemPrefix: "P", systemSuffix: "S" })
    );

    expect(payload.messages[0]).toEqual({
      role: "system",
      content: [
        { type: "text", text: "P", cache_control: CACHE_1H },
        { type: "text", text: "S" },
      ],
    });
    expect(payload).not.toHaveProperty("temperature");
  });

  it("marks a Google prefix with an ephemeral marker and no TTL, and keeps temperature", () => {
    const payload = buildOpenRouterPayload(
      request({ model: "google/gemini-3.8-flash", systemPrefix: "P", systemSuffix: "" })
    );

    expect(payload.messages[0].content).toEqual([{ type: "text", text: "P", cache_control: { type: "ephemeral" } }]);
    expect(payload.temperature).toBe(0.2);
  });

  it("sends other models a plain system string with no markers", () => {
    const payload = buildOpenRouterPayload(
      request({ model: "openai/gpt-oss-120b", systemPrefix: "P", systemSuffix: "S" })
    );

    expect(payload.messages[0]).toEqual({ role: "system", content: "PS" });
    expect(JSON.stringify(payload)).not.toContain("cache_control");
    expect(payload.temperature).toBe(0.2);
  });

  it("keeps a lone system prompt as a string for Anthropic models", () => {
    const payload = buildOpenRouterPayload(request({ model: "anthropic/claude-haiku-5.5", systemPrompt: "X" }));

    expect(payload.messages[0]).toEqual({ role: "system", content: "X" });
  });

  // [model, reasoning, the reasoning field sent]
  it.each<[string, ReasoningMode | undefined, { effort: ReasoningMode } | undefined]>([
    ["anthropic/claude-haiku-5.5", "none", { effort: "none" }],
    ["anthropic/claude-haiku-5.5", "high", { effort: "high" }],
    ["anthropic/claude-haiku-5.5", undefined, undefined],
    ["anthropic/claude-sonnet-5", "none", { effort: "none" }],
    ["anthropic/claude-opus-5", "none", { effort: "none" }],
    // These always think, so "none" sends nothing and the model uses its default
    ["anthropic/claude-opus-5.5", "none", undefined],
    ["anthropic/claude-opus-5.5", "low", { effort: "low" }],
    ["anthropic/claude-fable-5", "none", undefined],
    ["anthropic/claude-fable-5.1", "none", undefined],
    ["anthropic/claude-sonnet-5.5", "none", undefined],
    ["openai/gpt-5.6-luna", "none", { effort: "none" }],
    ["openai/gpt-6-sol", "low", { effort: "low" }],
    ["openai/gpt-6-astra", "none", undefined],
    ["openai/gpt-6.1-sol", "none", undefined],
    ["openai/gpt-6.1-sol", "high", { effort: "high" }],
    // Other vendors and models take no reasoning field
    ["openai/gpt-oss-120b", "high", undefined],
    ["google/gemini-3.8-flash", "high", undefined],
  ])("sends the reasoning field for %s at %s as %j", (model, reasoning, expected) => {
    expect(buildOpenRouterPayload(request({ model, reasoning })).reasoning).toEqual(expected);
  });

  // [model, temperature, max_tokens]: reasoning models reject temperature and get the Claude output room
  it.each<[string, number | undefined, number]>([
    ["anthropic/claude-haiku-5.5", undefined, 16000],
    // An older Claude id takes no thinking setting, so it keeps the shorter cap
    ["anthropic/claude-3.5-haiku", undefined, 4096],
    ["openai/gpt-5.6-luna", undefined, 16000],
    ["openai/gpt-6.1-sol", undefined, 16000],
    ["openai/gpt-4o", 0.2, 4096],
    ["openai/gpt-oss-120b", 0.2, 4096],
    ["google/gemini-3.8-flash", 0.2, 4096],
  ])("%s sends temperature %s and max_tokens %s", (model, temperature, maxTokens) => {
    const payload = buildOpenRouterPayload(request({ model, reasoning: "high" }));

    expect(payload.temperature).toBe(temperature);
    expect(payload.max_tokens).toBe(maxTokens);
  });
});

describe("OpenAI payload", () => {
  // [model, reasoning, reasoning_effort sent]
  it.each<[string, ReasoningMode | undefined, string | undefined]>([
    ["gpt-5.6-luna", "none", "none"],
    ["gpt-5.6-terra", "low", "low"],
    ["gpt-6-sol", "none", "none"],
    ["gpt-6-luna", "medium", "medium"],
    ["o3", "high", "high"],
    ["gpt-5.6-luna", undefined, undefined],
    // These always think, so "none" sends nothing and the model uses its default
    ["gpt-6-astra", "none", undefined],
    ["gpt-6.1-sol", "none", undefined],
    ["gpt-6.1-sol", "high", "high"],
    // GPT-5.0 has no "none"
    ["gpt-5", "none", undefined],
    ["gpt-5-mini", "none", undefined],
    ["gpt-5-mini", "low", "low"],
    // Not a reasoning model
    ["gpt-4o", "high", undefined],
    ["gpt-5-chat-latest", "high", undefined],
  ])("sends reasoning_effort for %s at %s as %s", (model, reasoning, effort) => {
    expect(buildOpenAIPayload(request({ model, reasoning })).reasoning_effort).toBe(effort);
  });

  it("gives a GPT-5 chat variant the plain request shape: temperature and the shorter cap", () => {
    const payload = buildOpenAIPayload(request({ model: "gpt-5-chat-latest", reasoning: "high" }));

    expect(payload).toMatchObject({ temperature: 0.2, max_tokens: 4096 });
    expect(payload).not.toHaveProperty("max_completion_tokens");
  });

  it("drops temperature and gives reasoning models the Claude output room", () => {
    const reasoning = buildOpenAIPayload(request({ model: "gpt-6-astra", reasoning: "high" }));
    expect(reasoning).toMatchObject({ max_completion_tokens: 16000, reasoning_effort: "high" });
    expect(reasoning).not.toHaveProperty("temperature");
    expect(reasoning).not.toHaveProperty("max_tokens");

    const plain = buildOpenAIPayload(request({ model: "gpt-4o", reasoning: "high" }));
    expect(plain).toMatchObject({ temperature: 0.2, max_tokens: 4096 });
    expect(plain).not.toHaveProperty("max_completion_tokens");
    expect(plain).not.toHaveProperty("reasoning_effort");
  });

  it("sends the prefix and suffix as one system string, and no thinking for a model without it", () => {
    const payload = buildOpenAIPayload(request({ model: "gpt-4o", systemPrefix: "P", systemSuffix: "S", reasoning: "none" }));

    expect(payload.messages[0]).toEqual({ role: "system", content: "PS" });
    expect(JSON.stringify(payload)).not.toContain("reasoning");
  });

  it("sends no thinking to Groq, even with a GPT-OSS model id", () => {
    const payload = buildOpenAIPayload(
      request({
        model: "openai/gpt-oss-120b",
        reasoning: "high",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
      })
    );

    expect(payload.model).toBe("openai/gpt-oss-120b");
    expect(payload).not.toHaveProperty("reasoning_effort");
    expect(payload.temperature).toBe(0.2);
  });
});

describe("dispatch and live options requests", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the cache parts and reasoning through to Anthropic", async () => {
    const answer = `<stage_1_intuition><verbal_summary>Use a hash map.</verbal_summary></stage_1_intuition>`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: answer } })}\n\n`, {
        status: 200,
      })
    );

    await dispatchDeepSolve({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
      prompt: "Two sum",
      systemPrefix: "P",
      systemSuffix: "S",
      reasoning: "none",
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.system).toEqual([
      { type: "text", text: "P", cache_control: CACHE_1H },
      { type: "text", text: "S" },
    ]);
  });

  it("asks Groq for live options with thinking off and keeps JSON mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"asked":null,"likely":[]}' } }] }), {
        status: 200,
      })
    );

    await fetchLiveOptions([], { apiKey: "gsk_test" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning_effort).toBe("none");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("leaves reasoning_effort to the default for non-Qwen Groq models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"asked":null,"likely":[]}' } }] }), {
        status: 200,
      })
    );

    await fetchLiveOptions([], { apiKey: "gsk_test", model: "openai/gpt-oss-120b" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning_effort).toBeUndefined();
  });
});
