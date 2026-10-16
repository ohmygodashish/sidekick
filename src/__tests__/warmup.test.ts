import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { WarmSettings } from "../services/ai/warmup";
import type { ReasoningMode } from "../services/ai/openrouter";

type WarmupModule = typeof import("../services/ai/warmup");
type DispatcherModule = typeof import("../services/ai/dispatcher");
type PromptModule = typeof import("../services/ai/promptTemplates");

const CACHE_1H = { type: "ephemeral", ttl: "1h" };
const MIN_54 = 54 * 60_000;
const MIN_55 = 55 * 60_000;

const base: WarmSettings = {
  selectedProvider: "anthropic",
  selectedModel: "claude-haiku-5-5",
  apiKeys: { openrouter: "", anthropic: "sk-ant-test", openai: "", groq: "" },
  profile: {
    resumeText: "Built payments at Acme.",
    jobDescription: "Backend role",
    targetCompany: "",
    seniorityPreset: "senior",
    tonePreset: "balanced",
  },
  activeModeId: "general",
  modes: [],
  outputLanguage: "English",
  answerThinking: true,
  answerThinkingLevel: "medium",
  pickThinking: false,
};

const withKeys = (apiKeys: Partial<WarmSettings["apiKeys"]>): WarmSettings => ({
  ...base,
  apiKeys: { ...base.apiKeys, ...apiKeys },
});

// Thinking off for the answer too: the picks' value and the typed value are both "none", so one warm-up request
const off: WarmSettings = { ...base, answerThinking: false };

// The warm-up and the dispatcher keep module state (throttles, the cached prefix), so each test loads fresh copies
let warmup: WarmupModule;
let dispatcher: DispatcherModule;
let prompts: PromptModule;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
  warmup = await import("../services/ai/warmup");
  dispatcher = await import("../services/ai/dispatcher");
  prompts = await import("../services/ai/promptTemplates");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const urls = () => fetchSpy.mock.calls.map(([url]) => String(url));
const sentBody = (i: number) => JSON.parse((fetchSpy.mock.calls[i][1] as RequestInit).body as string);

describe("warmConnections", () => {
  it("sends a no-cors HEAD to the answer provider's origin", () => {
    warmup.warmConnections({ ...base, selectedProvider: "openrouter" });

    expect(fetchSpy).toHaveBeenCalledWith("https://openrouter.ai/", {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
    });
  });

  it("warms each origin at most once in 30 seconds", () => {
    const settings = withKeys({});

    warmup.warmConnections(settings);
    warmup.warmConnections(settings);
    expect(urls()).toEqual(["https://api.anthropic.com/"]);

    vi.advanceTimersByTime(29_000);
    warmup.warmConnections(settings);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    warmup.warmConnections(settings);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("also warms Groq only when a Groq key is set", () => {
    warmup.warmConnections(withKeys({}));
    expect(urls()).not.toContain("https://api.groq.com/");

    warmup.warmConnections(withKeys({ groq: "gsk_test" }));
    expect(urls()).toContain("https://api.groq.com/");
  });

  it("never throws, even when the request fails", async () => {
    fetchSpy.mockRejectedValue(new TypeError("offline"));

    expect(() => warmup.warmConnections(withKeys({ groq: "gsk_test" }))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("warmPromptCache", () => {
  it("writes the prefix with one tiny non-streaming Anthropic request", async () => {
    await warmup.warmPromptCache(off);

    expect(urls()).toEqual(["https://api.anthropic.com/v1/messages"]);
    const { prefix } = prompts.currentSystemParts(base);
    expect(sentBody(0)).toMatchObject({
      stream: false,
      max_tokens: 0,
      messages: [{ role: "user", content: "." }],
      system: [{ type: "text", text: prefix, cache_control: CACHE_1H }],
    });
    // Thinking off, as the option picks and prefetch send it, so the cache entry is the one they read
    expect(sentBody(0).thinking).toEqual({ type: "disabled" });
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-api-key": "sk-ant-test" });
  });

  it("warms each thinking value answers use, once each, when the picks' and the typed value differ", async () => {
    await warmup.warmPromptCache(base);

    expect(urls()).toEqual(["https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages"]);
    // The picks' value (off by default) is sent first, then the typed value
    expect(sentBody(0).thinking).toEqual({ type: "disabled" });
    expect(sentBody(1)).toMatchObject({ stream: false, max_tokens: 0, output_config: { effort: "medium" } });
    expect(sentBody(1)).not.toHaveProperty("thinking");
  });

  it("sends one warm-up when the picks' value and the typed value are the same", async () => {
    await warmup.warmPromptCache({ ...base, pickThinking: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentBody(0).output_config).toEqual({ effort: "medium" });
  });

  it("skips a prefix that was warmed less than 55 minutes ago", async () => {
    await warmup.warmPromptCache(off);
    await warmup.warmPromptCache(off);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MIN_54);
    await warmup.warmPromptCache(off);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MIN_55 - MIN_54);
    await warmup.warmPromptCache(off);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("warms with the level option picks use, so the cache entry is the one they read", async () => {
    await warmup.warmPromptCache({ ...base, pickThinking: true, answerThinkingLevel: "high" });

    expect(sentBody(0).output_config).toEqual({ effort: "high" });
    expect(sentBody(0)).not.toHaveProperty("thinking");
  });

  it("warms with thinking off when the thinking switch is off, even with the picks switch on", async () => {
    await warmup.warmPromptCache({ ...base, answerThinking: false, pickThinking: true });

    expect(sentBody(0).thinking).toEqual({ type: "disabled" });
    expect(sentBody(0)).not.toHaveProperty("output_config");
  });

  it("does not warm OpenRouter at a thinking level, since its one-token warm-up would likely be refused", async () => {
    await warmup.warmPromptCache({
      ...base,
      selectedProvider: "openrouter",
      selectedModel: "anthropic/claude-haiku-5.5",
      apiKeys: { ...base.apiKeys, openrouter: "sk-or-test" },
      pickThinking: true,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not warm again when only the mode or the language changes", async () => {
    await warmup.warmPromptCache(off);
    await warmup.warmPromptCache({ ...off, activeModeId: "coding", outputLanguage: "German" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("warms again when the resume changes", async () => {
    await warmup.warmPromptCache(off);
    await warmup.warmPromptCache({ ...off, profile: { ...base.profile, resumeText: "Ran a search team." } });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("warms through OpenRouter for Anthropic models, with thinking off", async () => {
    await warmup.warmPromptCache({
      ...base,
      selectedProvider: "openrouter",
      selectedModel: "anthropic/claude-haiku-5.5",
      apiKeys: { ...base.apiKeys, openrouter: "sk-or-test" },
    });

    expect(urls()).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    const body = sentBody(0);
    expect(body).toMatchObject({
      model: "anthropic/claude-haiku-5.5",
      stream: false,
      max_tokens: 1,
      reasoning: { effort: "none" },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages[0].content[0].cache_control).toEqual(CACHE_1H);
  });

  it("does nothing for other providers, other OpenRouter models, or without a key", async () => {
    await warmup.warmPromptCache({ ...base, selectedProvider: "openai", selectedModel: "gpt-4o" });
    await warmup.warmPromptCache({ ...base, selectedProvider: "openrouter", selectedModel: "openai/gpt-oss-120b" });
    await warmup.warmPromptCache({ ...base, selectedProvider: "openrouter", selectedModel: "google/gemini-3.8-flash" });
    await warmup.warmPromptCache(withKeys({ anthropic: "  " }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records nothing when the warm-up fails, so the next call retries", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("overloaded", { status: 529 }));

    await expect(warmup.warmPromptCache(off)).resolves.toBeUndefined();
    await warmup.warmPromptCache(off);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("a real answer keeps the prefix warm", () => {
  const answer = () =>
    new Response(
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "<stage_1_intuition><verbal_summary>Use a hash map.</verbal_summary></stage_1_intuition>" },
      })}\n\n`,
      { status: 200 }
    );

  // A solve with the same prefix as the warm-up, sent with the given reasoning mode
  const solve = (reasoning: ReasoningMode = "none") => {
    const { prefix, suffix } = prompts.currentSystemParts(base);
    return dispatcher.dispatchDeepSolve({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
      prompt: "Two sum",
      systemPrefix: prefix,
      systemSuffix: suffix,
      reasoning,
    });
  };

  it("makes the next warm-up skip after a solve with the same prefix and reasoning none", async () => {
    fetchSpy.mockResolvedValueOnce(answer());

    await solve("none");
    await warmup.warmPromptCache(off);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not mark the none variant warm after an answer with thinking on", async () => {
    fetchSpy.mockResolvedValueOnce(answer());

    await solve("medium");
    await warmup.warmPromptCache(base);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("makes the warm-up skip after a solve at the level the picks use", async () => {
    fetchSpy.mockResolvedValueOnce(answer());

    await solve("medium");
    await warmup.warmPromptCache({ ...base, pickThinking: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not mark the prefix warm when the request fails before any text", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    await expect(solve("none")).rejects.toThrow();
    await warmup.warmPromptCache(off);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not mark the prefix warm when the request stalls before any text", async () => {
    fetchSpy.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );

    const failed = solve("none").catch((err) => err);
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await failed).message).toMatch(/stopped responding/);
    await warmup.warmPromptCache(off);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("marks the default-thinking shape warm after a solve retried without thinking", async () => {
    // Opus 5.5 can't turn thinking off, so "none" is sent with no thinking fields; a 400 naming thinking retries without it
    fetchSpy.mockResolvedValueOnce(new Response('{"error":"unsupported thinking"}', { status: 400 }));
    fetchSpy.mockResolvedValueOnce(answer());
    const { prefix, suffix } = prompts.currentSystemParts(base);

    await dispatcher.dispatchDeepSolve({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-opus-5-5",
      prompt: "Two sum",
      systemPrefix: prefix,
      systemSuffix: suffix,
      reasoning: "high",
    });
    await warmup.warmPromptCache({ ...off, selectedModel: "claude-opus-5-5" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not mark the prefix warm when the user cancels before any text", async () => {
    const controller = new AbortController();
    fetchSpy.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const { prefix, suffix } = prompts.currentSystemParts(base);

    const cancelled = dispatcher
      .dispatchDeepSolve({
        provider: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-haiku-5-5",
        prompt: "Two sum",
        systemPrefix: prefix,
        systemSuffix: suffix,
        reasoning: "none",
        signal: controller.signal,
      })
      .catch((err) => err);
    controller.abort();
    await cancelled;
    await warmup.warmPromptCache(off);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
