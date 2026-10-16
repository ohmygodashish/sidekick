import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import {
  getSeniorityPrompt,
  getTonePrompt,
  buildSystemPrompt,
  buildUserPrompt,
  solutionToText,
} from "../services/ai/promptTemplates";
import {
  buildAnthropicPayload,
  streamAnthropic,
} from "../services/ai/anthropic";
import {
  buildOpenAIPayload,
  streamOpenAI,
} from "../services/ai/openai";
import {
  buildOpenRouterPayload,
  streamOpenRouter,
  cleanBase64Data,
} from "../services/ai/openrouter";
import {
  parseProgressiveStream,
  readSSEStream,
} from "../services/ai/streamParser";
import { useDeepSolver } from "../hooks/useDeepSolver";
import { useSessionStore, activeThreadOf, requestSolve, STOPPED_MESSAGE, ThreadMessage } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import * as ipcModule from "../lib/ipc";
import { mimeTypeOfDataUrl } from "../services/ai/dispatcher";

const SOLUTION_XML = `<stage_1_intuition>
<verbal_summary>Use a hash map for a single pass.</verbal_summary>
<key_tradeoffs><tradeoff>O(N) extra memory</tradeoff></key_tradeoffs>
</stage_1_intuition>
<stage_2_code>
<language>python</language>
<code>def two_sum(nums, target): return []</code>
<explanation>Single pass.</explanation>
</stage_2_code>
<stage_3_analysis>
<time_complexity>O(N)</time_complexity>
<space_complexity>O(N)</space_complexity>
<edge_cases><edge_case>Empty input</edge_case></edge_cases>
</stage_3_analysis>`;

// One SSE response carrying the whole answer, shaped like an OpenRouter chat stream
function sseResponse(content: string) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200 });
}

function useOpenRouterKey() {
  useSettingsStore.setState((state) => ({
    apiKeys: { ...state.apiKeys, openrouter: "sk-or-test" },
  }));
}

// The solve requests come from requestSolve (the Ask box, options and Assist use the same path)
function TestDeepSolverComponent() {
  useDeepSolver();

  return (
    <div>
      <button
        data-testid="solve-btn"
        onClick={() => requestSolve({ question: "How would you design a distributed cache?" })}
      >
        Solve
      </button>
      <button data-testid="cancel-btn" onClick={() => window.dispatchEvent(new Event("sidekick:cancel_solve"))}>
        Cancel
      </button>
    </div>
  );
}

// The first line of SOLUTION_XML, so the rest of the answer can be streamed after it
const SUMMARY_TAG = "<stage_1_intuition>\n<verbal_summary>Use a hash map for a single pass.</verbal_summary>";
const REST_OF_SOLUTION = SOLUTION_XML.slice(SUMMARY_TAG.length);

/**
 * A provider stream the test feeds by hand. Aborting the request errors the stream, as a browser does,
 * so a superseded or cancelled answer stops reading.
 */
function controlledFetch() {
  const encoder = new TextEncoder();
  const streams: { push: (content: string) => void; finish: () => void }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
    init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    streams.push({
      push: (content) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)),
      finish: () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  return streams;
}

// The newest message of the active thread: where the solver streams its answer
const lastMessage = (): ThreadMessage => {
  const messages = activeThreadOf(useSessionStore.getState())?.messages ?? [];
  return messages[messages.length - 1];
};

const findMessage = (id: string): ThreadMessage | undefined => {
  for (const thread of useSessionStore.getState().threads) {
    const message = thread.messages.find((m) => m.id === id);
    if (message) return message;
  }
  return undefined;
};

describe("Task 12: Multi-Provider Deep Intelligence Gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().clearSession();
    useAppStore.setState({ isPanicked: false, isVisible: true });
    useSettingsStore.setState({
      selectedProvider: "openrouter",
      selectedModels: { openrouter: "anthropic/claude-haiku-5.5", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
      apiKeys: {
        openrouter: "",
        anthropic: "",
        openai: "",
        groq: "",
      },
      profile: {
        resumeText: "",
        jobDescription: "",
        targetCompany: "",
        seniorityPreset: "senior",
        tonePreset: "balanced",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Prompt Templates & Personalization Injection (REQ-016)", () => {
    it("generates correct seniority prompt directives across all tiers", () => {
      expect(getSeniorityPrompt("junior")).toContain("Junior Engineer");
      expect(getSeniorityPrompt("mid")).toContain("Mid-Level Engineer");
      expect(getSeniorityPrompt("senior")).toContain("Senior Engineer");
      expect(getSeniorityPrompt("staff")).toContain("Staff Engineer");
      expect(getSeniorityPrompt("principal")).toContain("Principal Architect");
    });

    it("generates correct tone preset directives across all presets", () => {
      expect(getTonePrompt("concise")).toContain("Extremely Concise");
      expect(getTonePrompt("balanced")).toContain("Balanced & Structured");
      expect(getTonePrompt("deep")).toContain("Deep Technical Rigor");
      expect(getTonePrompt("staff")).toContain("Staff Engineer");
      expect(getTonePrompt("system_architect")).toContain("System Architect");
    });

    it("injects candidate resume, job description, and target company into system prompt", () => {
      const systemPrompt = buildSystemPrompt({
        resumeText: "5 years building Kafka streaming pipelines and distributed key-value stores at Uber.",
        jobDescription: "Staff Software Engineer - Real-Time Storage Infrastructure.",
        targetCompany: "Stripe",
        seniorityPreset: "staff",
        tonePreset: "staff",
      });

      expect(systemPrompt).toContain("Target Company: Stripe");
      expect(systemPrompt).toContain("Real-Time Storage Infrastructure");
      expect(systemPrompt).toContain("Kafka streaming pipelines");
      expect(systemPrompt).toContain("Staff Engineer");
      expect(systemPrompt).toContain("<stage_1_intuition>");
      expect(systemPrompt).toContain("<stage_2_code>");
      expect(systemPrompt).toContain("<stage_3_analysis>");
    });

    it("constructs user prompt with question, transcript, and vision indicator", () => {
      const userPrompt = buildUserPrompt("Design a rate limiter for multi-tenant API", {
        transcript: "So I was wondering how you would design this?",
        hasImage: true,
      });

      expect(userPrompt).toContain(
        "A screenshot of the user's current screen (their active window) is attached. Use it together with the question."
      );
      expect(userPrompt).toContain("Design a rate limiter for multi-tenant API");
      expect(userPrompt).toContain("<transcript>\nSo I was wondering how you would design this?\n</transcript>");
      expect(userPrompt).not.toContain("previous_exchanges");
    });

    it("caps the trade-offs and edge cases of an earlier answer at five each", () => {
      const items = Array.from({ length: 8 }, (_, i) => `item ${i}`);
      const text = solutionToText({
        stage1Intuition: { verbalSummary: "Summary.", keyTradeoffs: items },
        stage2Code: null,
        stage3Analysis: { timeComplexity: "O(1)", spaceComplexity: "O(1)", edgeCases: items },
      });

      expect(text).toContain("- item 4");
      expect(text).not.toContain("item 5");
      expect(text.match(/- item/g)).toHaveLength(10);
    });

    it("puts the earlier exchanges of the thread before a follow-up, and keeps only the last six", () => {
      const history = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
      const userPrompt = buildUserPrompt("And the follow-up?", { history });

      const block = userPrompt.slice(userPrompt.indexOf("<previous_exchanges>"), userPrompt.indexOf("</previous_exchanges>"));
      expect(block).not.toContain("<question>Q2</question>");
      expect(block).toContain("<question>Q3</question>");
      expect(block).toContain("<answer>\nA8\n</answer>");
      expect(userPrompt).toContain("is a follow-up to the previous exchanges");
      expect(userPrompt.indexOf("<previous_exchanges>")).toBeLessThan(userPrompt.indexOf('Question / Coding Task:\n"And the follow-up?"'));
    });
  });

  describe("2. Provider Payload Builders & Vision Image Support (REQ-014)", () => {
    const sampleBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    it("cleans base64 data URI headers properly", () => {
      expect(cleanBase64Data(sampleBase64)).toBe(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      );
      expect(cleanBase64Data("rawBase64String")).toBe("rawBase64String");
    });

    it("builds Anthropic payload with native image content block", () => {
      const payload = buildAnthropicPayload({
        apiKey: "sk-ant-test",
        model: "anthropic/claude-3-5-sonnet-20241022",
        prompt: "Solve Two Sum",
        systemPrompt: "You are Sidekick",
        imageBase64: sampleBase64,
        onChunk: vi.fn(),
      });

      expect(payload.model).toBe("claude-3-5-sonnet-20241022");
      expect(payload.system).toBe("You are Sidekick");
      expect(payload.stream).toBe(true);
      expect(Array.isArray(payload.messages[0].content)).toBe(true);

      const imageBlock = payload.messages[0].content[0];
      expect(imageBlock.type).toBe("image");
      expect(imageBlock.source.type).toBe("base64");
      expect(imageBlock.source.media_type).toBe("image/png");
      expect(imageBlock.source.data).not.toContain("data:image/png;base64,");

      const textBlock = payload.messages[0].content[1];
      expect(textBlock.type).toBe("text");
      expect(textBlock.text).toBe("Solve Two Sum");
    });

    it("keeps the openai/ prefix for Groq and sends GPT-5 reasoning parameters", () => {
      const groq = buildOpenAIPayload({
        apiKey: "gsk-test",
        model: "openai/gpt-oss-120b",
        prompt: "Two sum",
        onChunk: vi.fn(),
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
      });
      expect(groq.model).toBe("openai/gpt-oss-120b");

      const gpt5 = buildOpenAIPayload({ apiKey: "sk-test", model: "openai/gpt-5.6-luna", prompt: "Two sum", onChunk: vi.fn() });
      expect(gpt5.model).toBe("gpt-5.6-luna");
      expect(gpt5.max_completion_tokens).toBe(16000);
      expect(gpt5.temperature).toBeUndefined();
      expect(gpt5.max_tokens).toBeUndefined();
    });

    it("builds OpenAI payload with image_url vision structure", () => {
      const payload = buildOpenAIPayload({
        apiKey: "sk-test",
        model: "openai/gpt-4o",
        prompt: "Reverse a linked list",
        systemPrompt: "System instruction",
        imageBase64: sampleBase64,
        onChunk: vi.fn(),
      });

      expect(payload.model).toBe("gpt-4o");
      expect(payload.stream).toBe(true);
      expect(payload.messages[0].role).toBe("system");
      expect(payload.messages[0].content).toBe("System instruction");

      const userMessage = payload.messages[1];
      expect(userMessage.role).toBe("user");
      expect(userMessage.content[0].type).toBe("text");
      expect(userMessage.content[1].type).toBe("image_url");
      expect(userMessage.content[1].image_url.url).toContain("data:image/png;base64,");
    });

    it("builds OpenRouter payload matching OpenAI vision spec", () => {
      const payload = buildOpenRouterPayload({
        apiKey: "sk-or-test",
        model: "anthropic/claude-3.5-sonnet",
        prompt: "Design Redis cache",
        systemPrompt: "System prompt",
        imageBase64: sampleBase64,
        onChunk: vi.fn(),
      });

      expect(payload.model).toBe("anthropic/claude-3.5-sonnet");
      expect(payload.stream).toBe(true);
      expect(payload.messages[1].content[1].type).toBe("image_url");
    });

  });

  describe("3. Progressive Streaming Parser (REQ-015, AC-006)", () => {
    it("parses unclosed streaming tags progressively into Stage 1, Stage 2, Stage 3", () => {
      // Chunk 1: Stage 1 started streaming
      const partial1 = `<stage_1_intuition>
<verbal_summary>
We should use a two-pointer approach because the array is sorted.`;
      const s1 = parseProgressiveStream(partial1);
      expect(s1.stage1Intuition?.verbalSummary).toBe(
        "We should use a two-pointer approach because the array is sorted."
      );
      expect(s1.stage2Code).toBeNull();
      expect(s1.stage3Analysis).toBeNull();

      // Chunk 2: Stage 1 closed, Stage 2 code streaming
      const partial2 = `${partial1}
</verbal_summary>
<key_tradeoffs>
<tradeoff>O(1) memory vs O(N) hash map memory</tradeoff>
</key_tradeoffs>
</stage_1_intuition>
<stage_2_code>
<language>python</language>
<code>
def two_sum(nums, target):
    left, right = 0, len(nums) - 1`;
      const s2 = parseProgressiveStream(partial2);
      expect(s2.stage1Intuition?.keyTradeoffs).toEqual([
        "O(1) memory vs O(N) hash map memory",
      ]);
      expect(s2.stage2Code?.language).toBe("python");
      expect(s2.stage2Code?.code).toContain("def two_sum");
      expect(s2.stage3Analysis).toBeNull();

      // Chunk 3: Complete response with Stage 3 analysis
      const complete = `${partial2}
    return [left, right]
</code>
<explanation>Two pointers converge until sum matches target.</explanation>
</stage_2_code>
<stage_3_analysis>
<time_complexity>O(N) single pass</time_complexity>
<space_complexity>O(1) auxiliary</space_complexity>
<edge_cases>
<edge_case>Negative numbers</edge_case>
<edge_case>Empty array</edge_case>
</edge_cases>
</stage_3_analysis>`;
      const s3 = parseProgressiveStream(complete);
      expect(s3.stage1Intuition?.verbalSummary).toBeTruthy();
      expect(s3.stage2Code?.explanation).toBe("Two pointers converge until sum matches target.");
      expect(s3.stage3Analysis?.timeComplexity).toBe("O(N) single pass");
      expect(s3.stage3Analysis?.spaceComplexity).toBe("O(1) auxiliary");
      expect(s3.stage3Analysis?.edgeCases).toEqual(["Negative numbers", "Empty array"]);
    });

    it("handles fallback to JSON format gracefully", () => {
      const jsonText = JSON.stringify({
        stage_1_intuition: {
          verbal_summary: "JSON verbal intuition",
          key_tradeoffs: ["Tradeoff A"],
        },
        stage_2_code: {
          language: "typescript",
          code: "export const x = 1;",
          explanation: "TS code",
        },
        stage_3_analysis: {
          time_complexity: "O(1)",
          space_complexity: "O(1)",
          edge_cases: ["Edge 1"],
        },
      });

      const parsed = parseProgressiveStream(jsonText);
      expect(parsed.stage1Intuition?.verbalSummary).toBe("JSON verbal intuition");
      expect(parsed.stage2Code?.language).toBe("typescript");
      expect(parsed.stage3Analysis?.timeComplexity).toBe("O(1)");
    });

    it("handles fallback to Markdown code blocks and headers", () => {
      const mdText = `### Stage 1: Intuition
We use an LRU cache with a doubly linked list and hash map.
- O(1) get and put
- Synchronized access

### Stage 2: Code
\`\`\`python
class LRUCache:
    pass
\`\`\`

### Stage 3: Complexity
Time Complexity: O(1) operations
Space Complexity: O(C) capacity
- Null capacity
- Eviction under memory pressure`;

      const parsed = parseProgressiveStream(mdText);
      expect(parsed.stage1Intuition?.verbalSummary).toContain("We use an LRU cache");
      expect(parsed.stage2Code?.language).toBe("python");
      expect(parsed.stage2Code?.code).toBe("class LRUCache:\n    pass");
      expect(parsed.stage3Analysis?.timeComplexity).toBe("O(1) operations");
    });
  });

  describe("4. SSE Stream Reading & Provider Stream Execution", () => {
    it("readSSEStream reads multi-chunk stream with arbitrary split points", async () => {
      const parts = [
        "data: {\"choices\": [{\"delta\": {\"conte",
        "nt\": \"Hello \"}}]}\n\n",
        "data: {\"choices\": [{\"delta\": {\"content\": \"World\"}}]}\n\n",
        "data: [DONE]\n\n",
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(encoder.encode(part));
          }
          controller.close();
        },
      });

      const lines: string[] = [];
      const mockResponse = new Response(stream);

      await readSSEStream(mockResponse, (line) => lines.push(line));

      expect(lines).toContain('data: {"choices": [{"delta": {"content": "Hello "}}]}');
      expect(lines).toContain('data: {"choices": [{"delta": {"content": "World"}}]}');
      expect(lines).toContain("data: [DONE]");
    });

    it("streamAnthropic parses content_block_delta events", async () => {
      const mockSSE = [
        'event: content_block_delta\n',
        'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Anthropic chunk"}}\n\n',
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(mockSSE));

      const chunks: string[] = [];
      const result = await streamAnthropic({
        apiKey: "sk-ant-test",
        prompt: "test",
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks).toEqual(["Anthropic chunk"]);
      expect(result).toBe("Anthropic chunk");
    });

    it("streamOpenRouter parses delta choices", async () => {
      const mockSSE = [
        'data: {"choices": [{"delta": {"content": "OpenRouter chunk"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(mockSSE));

      const chunks: string[] = [];
      const result = await streamOpenRouter({
        apiKey: "sk-or-test",
        prompt: "test",
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks).toEqual(["OpenRouter chunk"]);
      expect(result).toBe("OpenRouter chunk");
    });

    it("streamOpenAI parses delta choices", async () => {
      const mockSSE = [
        'data: {"choices": [{"delta": {"content": "OpenAI chunk"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(mockSSE));

      const chunks: string[] = [];
      const result = await streamOpenAI({
        apiKey: "sk-test",
        prompt: "test",
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks).toEqual(["OpenAI chunk"]);
      expect(result).toBe("OpenAI chunk");
    });
  });

  describe("6. React Hook useDeepSolver & Panic Killswitch (Constraint 4, REQ-004, AC-002)", () => {
    it("streams the answer into the question's message as it arrives", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });
      await waitFor(() => expect(streams).toHaveLength(1));
      act(() => streams[0].push(SUMMARY_TAG));

      await waitFor(() => expect(lastMessage().solution?.stage1Intuition?.verbalSummary).toBe("Use a hash map for a single pass."));
      expect(useSessionStore.getState().solvingMessageId).toBe(lastMessage().id);

      act(() => {
        streams[0].push(REST_OF_SOLUTION);
        streams[0].finish();
      });
      await waitFor(() => expect(lastMessage().solution?.stage3Analysis).not.toBeNull());

      const message = lastMessage();
      expect(message.question).toBe("How would you design a distributed cache?");
      expect(message.solution?.stage1Intuition).not.toBeNull();
      expect(message.solution?.stage2Code).not.toBeNull();
      expect(message.error).toBeNull();
      expect(useSessionStore.getState().solvingMessageId).toBeNull();
    });

    it("triggers window capture silently if available during solve", async () => {
      const captureSpy = vi.spyOn(ipcModule, "captureActiveWindow").mockResolvedValueOnce({
        base64_image: "dummy-screen-base64",
        width: 1920,
        height: 1080,
      });

      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });

      expect(captureSpy).toHaveBeenCalled();
    });

    it("synchronously cancels in-flight stream when triggerPanic is activated (< 25ms, REQ-004)", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });
      await waitFor(() => expect(streams).toHaveLength(1));

      // Trigger panic killswitch
      await act(async () => {
        useAppStore.setState({ isPanicked: true, isVisible: false });
      });

      expect(useSessionStore.getState().solvingMessageId).toBeNull();
      expect(useSessionStore.getState().threads).toEqual([]);
    });

    it("starts solving when window event sidekick:deep_solve is triggered", async () => {
      useOpenRouterKey();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(SOLUTION_XML));
      render(<TestDeepSolverComponent />);

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("sidekick:deep_solve", {
            detail: { question: "How do you mitigate hot keys in Redis?", kind: "option", newThread: true },
          })
        );
      });

      await waitFor(() => expect(lastMessage().solution?.stage3Analysis).not.toBeNull());
      expect(lastMessage().kind).toBe("option");
      expect(lastMessage().solution?.stage2Code).not.toBeNull();
    });

    it("marks the answer as viewing the screen only when a screenshot was attached", async () => {
      useOpenRouterKey();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(SOLUTION_XML));
      const captureSpy = vi.spyOn(ipcModule, "captureActiveWindow").mockResolvedValueOnce({
        base64_image: "data:image/jpeg;base64,/9j/4AAQ",
        width: 1280,
        height: 800,
      });
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });
      await waitFor(() => expect(lastMessage().solution).not.toBeNull());
      expect(captureSpy).toHaveBeenCalled();
      expect(lastMessage().viewedScreen).toBe(true);
    });

    it("sends the image with its real MIME type and the earlier exchange of the thread as a follow-up", async () => {
      useOpenRouterKey();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(SOLUTION_XML));
      vi.spyOn(ipcModule, "captureActiveWindow").mockResolvedValue({
        base64_image: "data:image/jpeg;base64,/9j/4AAQ",
        width: 1280,
        height: 800,
      });
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });
      await waitFor(() => expect(lastMessage().solution).not.toBeNull());

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("sidekick:deep_solve", {
            detail: { question: "Which one would you pick?", captureWindow: false },
          })
        );
      });
      await waitFor(() => expect(lastMessage().question).toBe("Which one would you pick?"));
      await waitFor(() => expect(useSessionStore.getState().solvingMessageId).toBeNull());

      const firstBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(JSON.stringify(firstBody)).toContain("data:image/jpeg;base64");
      expect(mimeTypeOfDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe("image/jpeg");

      const followUpBody = JSON.stringify(JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string));
      expect(followUpBody).toContain("<previous_exchanges>");
      expect(followUpBody).toContain("<question>How would you design a distributed cache?</question>");
      expect(followUpBody).toContain("Use a hash map for a single pass.");
      expect(followUpBody).not.toContain("data:image/jpeg;base64");
    });

    it("allows cancelling at any point with sidekick:cancel_solve", async () => {
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
        screen.getByTestId("cancel-btn").click();
      });

      expect(useSessionStore.getState().solvingMessageId).toBeNull();
      expect(useSessionStore.getState().threads).toEqual([]);
    });

    it("deduplicates rapid solve requests for same question within 500ms window", async () => {
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
        screen.getByTestId("solve-btn").click();
        screen.getByTestId("solve-btn").click();
      });

      expect(activeThreadOf(useSessionStore.getState())?.messages).toHaveLength(1);
    });
  });

  describe("7. Stopped answers: superseded, cleared or reopened mid-stream", () => {
    const PARTIAL = "<stage_1_intuition>\n<verbal_summary>Partial summary</verbal_summary>";

    it("a new question stops a streaming answer: a partial one says it stopped, and the new one answers", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      render(<TestDeepSolverComponent />);

      act(() => requestSolve({ question: "First?", newThread: true }));
      await waitFor(() => expect(streams).toHaveLength(1));
      act(() => streams[0].push(PARTIAL));
      await waitFor(() => expect(lastMessage().solution?.stage1Intuition?.verbalSummary).toBe("Partial summary"));
      const firstId = lastMessage().id;

      act(() => requestSolve({ question: "Second?" }));
      await waitFor(() => expect(streams).toHaveLength(2));

      const messages = activeThreadOf(useSessionStore.getState())?.messages ?? [];
      expect(messages.map((m) => m.question)).toEqual(["First?", "Second?"]);
      expect(messages[0]).toMatchObject({ id: firstId, error: STOPPED_MESSAGE });
      expect(messages[0].solution?.stage1Intuition?.verbalSummary).toBe("Partial summary");

      act(() => {
        streams[1].push(SUMMARY_TAG + REST_OF_SOLUTION);
        streams[1].finish();
      });
      await waitFor(() => expect(lastMessage().solution?.stage3Analysis).not.toBeNull());
      expect(lastMessage().error).toBeNull();
    });

    it("a new question that comes before any text removes the unanswered message", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      render(<TestDeepSolverComponent />);

      act(() => requestSolve({ question: "Silent?", newThread: true }));
      await waitFor(() => expect(streams).toHaveLength(1));
      act(() => requestSolve({ question: "Next?" }));
      await waitFor(() => expect(streams).toHaveLength(2));

      expect((activeThreadOf(useSessionStore.getState())?.messages ?? []).map((m) => m.question)).toEqual(["Next?"]);
    });

    it("clearing history mid-stream stops the answer, and a late write goes nowhere", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      render(<TestDeepSolverComponent />);

      act(() => requestSolve({ question: "Clear me?", newThread: true }));
      await waitFor(() => expect(streams).toHaveLength(1));
      act(() => streams[0].push(PARTIAL));
      await waitFor(() => expect(lastMessage().solution).not.toBeNull());
      const threadId = activeThreadOf(useSessionStore.getState())!.id;
      const messageId = lastMessage().id;

      act(() => useSessionStore.getState().clearThreads());
      expect(useSessionStore.getState().threads).toEqual([]);
      expect(useSessionStore.getState().solvingMessageId).toBeNull();

      useSessionStore.getState().updateMessage(threadId, messageId, { solution: null, error: "late" });
      expect(useSessionStore.getState().threads).toEqual([]);
    });

    it("reopening another chat mid-stream keeps writing to the original message", async () => {
      useOpenRouterKey();
      const streams = controlledFetch();
      const other = useSessionStore
        .getState()
        .beginMessage({ question: "Other chat", kind: "typed", newThread: true })!;
      render(<TestDeepSolverComponent />);

      act(() => requestSolve({ question: "Streaming chat?", newThread: true }));
      await waitFor(() => expect(streams).toHaveLength(1));
      const streamingId = lastMessage().id;

      act(() => useSessionStore.getState().openThread(other.threadId));
      act(() => streams[0].push(SUMMARY_TAG));

      await waitFor(() => expect(findMessage(streamingId)?.solution?.stage1Intuition).not.toBeNull());
      expect(activeThreadOf(useSessionStore.getState())?.id).toBe(other.threadId);
      expect(activeThreadOf(useSessionStore.getState())?.messages[0].solution).toBeNull();

      act(() => {
        streams[0].push(REST_OF_SOLUTION);
        streams[0].finish();
      });
      await waitFor(() => expect(findMessage(streamingId)?.solution?.stage3Analysis).not.toBeNull());
      expect(findMessage(streamingId)?.error).toBeNull();
    });

    it("a finished answer is not touched when a new question follows it", async () => {
      useOpenRouterKey();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse(SOLUTION_XML));
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });
      await waitFor(() => expect(lastMessage().solution?.stage3Analysis).not.toBeNull());
      const finished = lastMessage();

      const streams = controlledFetch();
      act(() => requestSolve({ question: "And then?" }));
      await waitFor(() => expect(streams).toHaveLength(1));

      expect(findMessage(finished.id)).toMatchObject({ error: null });
      expect(findMessage(finished.id)?.solution?.stage3Analysis).not.toBeNull();
      streams[0].finish();
    });
  });
});
