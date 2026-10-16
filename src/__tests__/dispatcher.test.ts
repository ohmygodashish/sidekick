import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchDeepSolve } from "../services/ai/dispatcher";

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
};

// Streams below use OpenRouter's chat-completion events, which is what sseLine emits
const openRouterRequest = { provider: "openrouter" as const, apiKey: "sk-or-test", prompt: "Two sum" };

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
      dispatchDeepSolve({ provider: "groq", apiKey: "  ", prompt: "Two sum" })
    ).rejects.toMatchObject({ message: "Add your Groq API key in Settings → Keys." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [401, "bad key", "Anthropic rejected the API key. Check it in Settings → Keys."],
    [403, "forbidden", "Anthropic rejected the API key. Check it in Settings → Keys."],
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

    const err = await dispatchDeepSolve({ provider: "openrouter", apiKey: "sk-or-test", prompt: "x" }).catch(
      (e) => e
    );

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
