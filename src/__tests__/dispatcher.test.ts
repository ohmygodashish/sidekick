import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchDeepSolve, reasoningFor } from "../services/ai/dispatcher";
import type { ReasoningMode } from "../services/ai/openrouter";
import type { SettingsState } from "../store/settingsStore";
import type { MessageKind } from "../store/sessionStore";

const ANSWER_XML = `<stage_1_intuition><verbal_summary>Use a hash map.</verbal_summary></stage_1_intuition>`;

function sseLine(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function sseResponse(content: string): Response {
  return new Response(`${sseLine(content)}data: [DONE]\n\n`, { status: 200 });
}

// Fetch that never answers, but rejects when the request is aborted, as the browser does
function hangingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError"))
        );
      })
  );
}

const anthropicRequest = {
  provider: "anthropic" as const,
  apiKey: "sk-ant-test",
  model: "claude-haiku-5-5",
  prompt: "Two sum",
  reasoning: "none" as const,
};

// Streams below use OpenRouter's chat-completion events, which is what sseLine emits
const openRouterRequest = {
  provider: "openrouter" as const,
  apiKey: "sk-or-test",
  prompt: "Two sum",
  reasoning: "none" as const,
};

describe("dispatchDeepSolve", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks for a key and never calls the network when none is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      dispatchDeepSolve({ provider: "anthropic", apiKey: "  ", prompt: "Two sum", reasoning: "none" })
    ).rejects.toMatchObject({ message: "Add your Anthropic API key in Settings → General." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [401, "bad key", "Anthropic rejected the API key. Check it in Settings → General."],
    [403, "forbidden", "Anthropic rejected the API key. Check it in Settings → General."],
    [404, "not found", 'Anthropic doesn\'t recognise the model "claude-haiku-5-5". Pick another in Settings.'],
    [400, "invalid model id", 'Anthropic doesn\'t recognise the model "claude-haiku-5-5". Pick another in Settings.'],
    [400, "messages missing", "Anthropic returned HTTP 400."],
    [429, "slow down", "Anthropic is rate-limiting requests. Wait a moment, then retry."],
    [503, "overloaded", "Anthropic is having problems (HTTP 503). Retry in a moment."],
    [418, "teapot", "Anthropic returned HTTP 418."],
  ])("maps HTTP %i to a short message", async (status, body, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { status }));

    await expect(dispatchDeepSolve(anthropicRequest)).rejects.toMatchObject({ message });
  });

  it("maps a network failure to a connection hint and keeps the raw error as cause", async () => {
    const network = new TypeError("Failed to fetch");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(network);

    const err = await dispatchDeepSolve({
      provider: "openrouter",
      apiKey: "sk-or-test",
      prompt: "x",
      reasoning: "none",
    }).catch((e) => e);

    expect(err.message).toBe("Couldn't reach OpenRouter. Check your connection.");
    expect(err.cause).toBe(network);
  });

  it("rethrows a user cancel unchanged so the caller can ignore it", async () => {
    hangingFetch();
    const controller = new AbortController();

    const promise = dispatchDeepSolve({ ...anthropicRequest, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
      message: "The operation was aborted.",
    });
  });

  it("stops a request that gets no response for 25 seconds", async () => {
    vi.useFakeTimers();
    const fetchSpy = hangingFetch();

    const promise = dispatchDeepSolve(anthropicRequest).catch((e) => e);
    await vi.advanceTimersByTimeAsync(25_000);

    expect((await promise).message).toBe(
      "The model stopped responding. Retry, or pick a faster model in Settings."
    );
    const sent = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(sent.signal?.aborted).toBe(true);
  });

  it("resets the stall timer on every chunk", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    const promise = dispatchDeepSolve(openRouterRequest);
    for (const piece of ["<stage_1_intuition><verbal_summary>Use a hash map.", " One pass.", "</verbal_summary></stage_1_intuition>"]) {
      await vi.advanceTimersByTimeAsync(20_000);
      push.enqueue(encoder.encode(sseLine(piece)));
    }
    push.enqueue(encoder.encode("data: [DONE]\n\n"));
    push.close();

    const solution = await promise;
    expect(solution.stage1Intuition?.verbalSummary).toBe("Use a hash map. One pass.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts keep-alive comments as activity, so a long think isn't cut off", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    const promise = dispatchDeepSolve(openRouterRequest);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      push.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
    }
    push.enqueue(encoder.encode(sseLine(ANSWER_XML)));
    push.enqueue(encoder.encode("data: [DONE]\n\n"));
    push.close();

    const solution = await promise;
    expect(solution.stage1Intuition?.verbalSummary).toBe("Use a hash map.");
  });

  it("throws the empty-answer message when the stream has no answer content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200 }));

    await expect(dispatchDeepSolve(openRouterRequest)).rejects.toMatchObject({
      message: "The model returned an empty answer. Retry, or pick another model in Settings.",
    });
  });

  it("parses a complete answer and leaves no timer running", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse(ANSWER_XML));

    const solution = await dispatchDeepSolve(openRouterRequest);

    expect(solution.stage1Intuition?.verbalSummary).toBe("Use a hash map.");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reasoningFor", () => {
  // Haiku can turn thinking off, so these cases follow the switches
  const haiku = {
    selectedProvider: "openrouter" as const,
    selectedModels: { openrouter: "anthropic/claude-haiku-5.5", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
  };
  type Thinking = Pick<
    SettingsState,
    "answerThinking" | "answerThinkingLevel" | "pickThinking" | "selectedProvider" | "selectedModels"
  >;
  const off: Thinking = { ...haiku, answerThinking: false, answerThinkingLevel: "high", pickThinking: true };
  const on = (answerThinkingLevel: Thinking["answerThinkingLevel"], pickThinking = false): Thinking => ({
    ...haiku,
    answerThinking: true,
    answerThinkingLevel,
    pickThinking,
  });
  // A level from a hand-edited config, which the type doesn't allow
  const bogus = "bogus" as unknown as Thinking["answerThinkingLevel"];

  it.each<[string, MessageKind, Thinking, ReasoningMode]>([
    ["thinking off: a typed question", "typed", off, "none"],
    ["thinking off: Assist", "assist", off, "none"],
    ["thinking off: an option pick, even with picks on", "option", off, "none"],
    ["picks off: a typed question thinks at the level", "typed", on("low"), "low"],
    ["picks off: Assist thinks at the level", "assist", on("high"), "high"],
    ["picks off: an option pick stays fast", "option", on("high"), "none"],
    ["picks on: an option pick thinks at the level", "option", on("low", true), "low"],
    ["picks on: an option pick at medium", "option", on("medium", true), "medium"],
    ["picks on: an option pick at high", "option", on("high", true), "high"],
    ["an unknown level falls back to medium for a typed question", "typed", on(bogus), "medium"],
    ["an unknown level falls back to medium for a pick", "option", on(bogus, true), "medium"],
  ])("%s", (_name, kind, settings, expected) => {
    expect(reasoningFor(kind, settings)).toBe(expected);
  });
});

describe("reasoningFor on Sonnet 5.5, which always thinks", () => {
  const settings = (model: string, answerThinking: boolean, pickThinking: boolean) => ({
    selectedProvider: "openrouter" as const,
    selectedModels: { openrouter: model, anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
    answerThinking,
    answerThinkingLevel: "low" as const,
    pickThinking,
  });

  it("uses the chosen level for an option pick with picks off", () => {
    expect(reasoningFor("option", settings("anthropic/claude-sonnet-5.5", true, false))).toBe("low");
  });

  it("uses the chosen level for a typed question with thinking off", () => {
    expect(reasoningFor("typed", settings("anthropic/claude-sonnet-5.5", false, false))).toBe("low");
  });

  it("turns thinking off for Haiku when the switches are off", () => {
    expect(reasoningFor("typed", settings("anthropic/claude-haiku-5.5", false, false))).toBe("none");
    expect(reasoningFor("option", settings("anthropic/claude-haiku-5.5", true, false))).toBe("none");
  });
});

describe("retrying a thinking setting that a provider refuses", () => {
  const refusal = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 });
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
  const anthropicAnswer = () =>
    new Response(
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: ANSWER_XML } })}\n\n`,
      { status: 200 }
    );

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gives the retried request a full stall window of its own", async () => {
    vi.useFakeTimers();
    let refuse!: (response: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            refuse = resolve;
          })
      )
      .mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      );

    const failure = dispatchDeepSolve({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6-sol",
      prompt: "x",
      reasoning: "high",
    }).catch((e) => e);
    let settled = false;
    void failure.then(() => {
      settled = true;
    });

    // The refusal comes 20 s in, most of the way through the first request's 25 s
    await vi.advanceTimersByTimeAsync(20_000);
    refuse(refusal("reasoning_effort is not supported"));
    // 40 s in, the retry is still inside its own 25 s, so nothing has failed yet
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect((await failure).message).toBe("The model stopped responding. Retry, or pick a faster model in Settings.");
  });

  it("retries once without thinking when a 400 names reasoning_effort, and answers", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(refusal("Unsupported parameter: reasoning_effort"))
      .mockResolvedValueOnce(sseResponse(ANSWER_XML));

    const solution = await dispatchDeepSolve({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6-sol",
      prompt: "Two sum",
      reasoning: "high",
    });

    expect(solution.stage1Intuition?.verbalSummary).toBe("Use a hash map.");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchSpy.mock.calls[0])).toMatchObject({ reasoning_effort: "high" });
    expect(bodyOf(fetchSpy.mock.calls[1])).not.toHaveProperty("reasoning_effort");
  });

  it("retries an Anthropic thinking refusal with the model's default thinking", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(refusal("thinking.output_config is not supported for this model"))
      .mockResolvedValueOnce(anthropicAnswer());

    await dispatchDeepSolve({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
      prompt: "Two sum",
      reasoning: "low",
    });

    expect(bodyOf(fetchSpy.mock.calls[0])).toMatchObject({ output_config: { effort: "low" } });
    const retried = bodyOf(fetchSpy.mock.calls[1]);
    expect(retried).not.toHaveProperty("output_config");
    expect(retried).not.toHaveProperty("thinking");
    expect(retried.max_tokens).toBe(16000);
  });

  it("gives the retry at most one chance: a second refusal is reported", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(refusal("reasoning not allowed"))
      .mockResolvedValueOnce(refusal("reasoning not allowed"));

    await expect(
      dispatchDeepSolve({ provider: "openai", apiKey: "sk-test", model: "gpt-6-sol", prompt: "x", reasoning: "high" })
    ).rejects.toMatchObject({ message: "OpenAI returned HTTP 400." });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 that doesn't name thinking", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(refusal("messages missing"));

    await expect(
      dispatchDeepSolve({ provider: "openai", apiKey: "sk-test", model: "gpt-6-sol", prompt: "x", reasoning: "high" })
    ).rejects.toMatchObject({ message: "OpenAI returned HTTP 400." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the request sent no thinking fields to begin with", async () => {
    // GPT-6 Astra can't turn thinking off, so "none" is sent as nothing and a refusal can't be about it
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(refusal("reasoning_effort is not supported"));

    await expect(
      dispatchDeepSolve({ provider: "openai", apiKey: "sk-test", model: "gpt-6-astra", prompt: "x", reasoning: "none" })
    ).rejects.toMatchObject({ message: "OpenAI returned HTTP 400." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400 that is about something other than thinking", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(refusal("max_tokens is too large"));

    await expect(
      dispatchDeepSolve({ provider: "anthropic", apiKey: "sk-ant-test", model: "claude-haiku-5-5", prompt: "x", reasoning: "high" })
    ).rejects.toMatchObject({ message: "Anthropic returned HTTP 400." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
