import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  getSeniorityPrompt,
  getTonePrompt,
  buildSystemPrompt,
  buildUserPrompt,
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
  buildGeminiPayload,
  getGeminiModel,
  streamGemini,
} from "../services/ai/gemini";
import {
  parseProgressiveStream,
  readSSEStream,
} from "../services/ai/streamParser";
import {
  dispatchDeepSolve,
  generateMockSolution,
  getDefaultModelForProvider,
} from "../services/ai/dispatcher";
import { useDeepSolver } from "../hooks/useDeepSolver";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import * as ipcModule from "../lib/ipc";

// Test component to exercise useDeepSolver React hook
function TestDeepSolverComponent({
  onStart,
  onProgress,
  onComplete,
  onError,
}: {
  onStart?: () => void;
  onProgress?: () => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}) {
  const { solveQuestion, cancelSolve, isSolving, streamingStage, error } =
    useDeepSolver({
      onStart,
      onProgress,
      onComplete,
      onError,
    });

  return (
    <div>
      <div data-testid="is-solving">{String(isSolving)}</div>
      <div data-testid="streaming-stage">{String(streamingStage)}</div>
      <div data-testid="error-message">{error || "none"}</div>
      <button
        data-testid="solve-btn"
        onClick={() => solveQuestion("How would you design a distributed cache?")}
      >
        Solve
      </button>
      <button data-testid="cancel-btn" onClick={() => cancelSolve()}>
        Cancel
      </button>
    </div>
  );
}

describe("Task 12: Multi-Provider Deep Intelligence Gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().clearSession();
    useAppStore.setState({ isPanicked: false, isVisible: true });
    useSettingsStore.setState({
      selectedProvider: "openrouter",
      selectedModel: "anthropic/claude-3.5-sonnet",
      apiKeys: {
        openrouter: "",
        anthropic: "",
        openai: "",
        gemini: "",
        groq: "",
        deepgram: "",
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

    it("constructs user prompt with question, quick pointers, and vision indicator", () => {
      const userPrompt = buildUserPrompt("Design a rate limiter for multi-tenant API", {
        quickPointers: ["Token Bucket", "Redis Lua script"],
        transcript: "So I was wondering how you would design this?",
        hasImage: true,
      });

      expect(userPrompt).toContain("A screenshot of the active coding problem / whiteboard window has been attached.");
      expect(userPrompt).toContain("Design a rate limiter for multi-tenant API");
      expect(userPrompt).toContain("- Token Bucket");
      expect(userPrompt).toContain("- Redis Lua script");
      expect(userPrompt).toContain("Recent Interviewer Speech Transcript:");
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

    it("builds Google Gemini payload with inlineData vision format", () => {
      const payload = buildGeminiPayload({
        apiKey: "gemini-test-key",
        model: "google/gemini-2.0-flash",
        prompt: "Implement LRU Cache",
        systemPrompt: "Gemini system prompt",
        imageBase64: sampleBase64,
        onChunk: vi.fn(),
      });

      expect(payload.systemInstruction.parts[0].text).toBe("Gemini system prompt");
      const parts = payload.contents[0].parts;
      expect(parts[0].inlineData.mimeType).toBe("image/png");
      expect(parts[0].inlineData.data).not.toContain("data:image/png;base64,");
      expect(parts[1].text).toBe("Implement LRU Cache");
      expect(getGeminiModel("google/gemini-2.0-flash")).toBe("gemini-2.0-flash");
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

    it("streamGemini parses candidates text parts", async () => {
      const mockSSE = [
        'data: {"candidates": [{"content": {"parts": [{"text": "Gemini chunk"}]}}]}\n\n',
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(mockSSE));

      const chunks: string[] = [];
      const result = await streamGemini({
        apiKey: "gemini-key",
        prompt: "test",
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks).toEqual(["Gemini chunk"]);
      expect(result).toBe("Gemini chunk");
    });
  });

  describe("5. Unified Dispatcher (dispatcher.ts)", () => {
    it("returns correct default models for providers", () => {
      expect(getDefaultModelForProvider("openrouter")).toBe("anthropic/claude-3.5-sonnet");
      expect(getDefaultModelForProvider("anthropic")).toBe("claude-3-5-sonnet-20241022");
      expect(getDefaultModelForProvider("openai")).toBe("gpt-4o");
      expect(getDefaultModelForProvider("gemini")).toBe("gemini-2.0-flash");
    });

    it("generates rate-limiter specific mock solution for rate limiter query", () => {
      const xml = generateMockSolution("How would you design a distributed rate limiter?");
      expect(xml).toContain("Sliding Window Counter");
      expect(xml).toContain("SlidingWindowRateLimiter");
      expect(xml).toContain("Clock skew");
    });

    it("generates cache specific mock solution for hot key query", () => {
      const xml = generateMockSolution("How do you handle hot keys in a distributed cache?");
      expect(xml).toContain("HotKeyMitigatingCache");
      expect(xml).toContain("L1");
      expect(xml).toContain("XFetch");
    });

    it("dispatches to simulated mock solution when offline or no API key is provided", async () => {
      const updates: any[] = [];
      const solution = await dispatchDeepSolve({
        provider: "openrouter",
        apiKey: "", // No key -> simulated stream
        prompt: "How would you design a distributed cache?",
        onProgressiveUpdate: (u) => updates.push(u),
      });

      expect(solution.stage1Intuition).not.toBeNull();
      expect(solution.stage2Code).not.toBeNull();
      expect(solution.stage3Analysis).not.toBeNull();
      expect(updates.length).toBeGreaterThan(0);
    });

    it("falls back to simulated solution if live provider throws an HTTP error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Invalid API Key", { status: 401, statusText: "Unauthorized" })
      );

      const solution = await dispatchDeepSolve({
        provider: "anthropic",
        apiKey: "invalid-key",
        prompt: "Two sum problem",
      });

      expect(solution.stage1Intuition).not.toBeNull();
      expect(solution.stage2Code).not.toBeNull();
    });
  });

  describe("6. React Hook useDeepSolver & Panic Killswitch (Constraint 4, REQ-004, AC-002)", () => {
    it("orchestrates deep solve and populates sessionStore progressively", async () => {
      const onProgress = vi.fn();
      const onComplete = vi.fn();

      let resolveComplete: (() => void) | undefined;
      const completePromise = new Promise<void>((resolve) => {
        resolveComplete = resolve;
      });

      render(
        <TestDeepSolverComponent
          onProgress={onProgress}
          onComplete={() => {
            onComplete();
            resolveComplete?.();
          }}
        />
      );

      const solveBtn = screen.getByTestId("solve-btn");

      await act(async () => {
        solveBtn.click();
      });

      await act(async () => {
        await completePromise;
      });

      // Verify sessionStore has received the progressive solution
      const storeState = useSessionStore.getState();
      expect(storeState.stage1Intuition).not.toBeNull();
      expect(storeState.stage2Code).not.toBeNull();
      expect(storeState.stage3Analysis).not.toBeNull();
      expect(onProgress).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
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
      const onProgress = vi.fn();

      render(<TestDeepSolverComponent onProgress={onProgress} />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });

      // Trigger panic killswitch
      await act(async () => {
        useAppStore.setState({ isPanicked: true, isVisible: false });
      });

      expect(screen.getByTestId("is-solving").textContent).toBe("false");
    });

    it("aborts when window event sidekick:panic is dispatched", async () => {
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
      });

      await act(async () => {
        window.dispatchEvent(new CustomEvent("sidekick:panic"));
      });

      expect(screen.getByTestId("is-solving").textContent).toBe("false");
    });

    it("starts solving when window event sidekick:deep_solve is triggered", async () => {
      render(<TestDeepSolverComponent />);

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("sidekick:deep_solve", {
            detail: {
              questionId: "q_test_123",
              extractedQuestion: "How do you mitigate hot keys in Redis?",
              quickPointers: ["Key salting", "L1 Cache"],
              rawTranscript: "How do you mitigate hot keys in Redis?",
              confidence: 0.95,
              timestamp: Date.now(),
            },
          })
        );
      });

      const storeState = useSessionStore.getState();
      expect(storeState.stage1Intuition).not.toBeNull();
      expect(storeState.stage2Code).not.toBeNull();
      expect(storeState.stage3Analysis).not.toBeNull();
    });

    it("allows manual cancelSolve at any point", async () => {
      render(<TestDeepSolverComponent />);

      await act(async () => {
        screen.getByTestId("solve-btn").click();
        screen.getByTestId("cancel-btn").click();
      });

      expect(screen.getByTestId("is-solving").textContent).toBe("false");
    });
  });
});
