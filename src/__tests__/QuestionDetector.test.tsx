import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  stripFillerWords,
  classifyQuestionIntent,
  mockEvaluateQuestion,
  generateQuickPointers,
  detectQuestion,
} from "../services/ai/questionDetector";
import { useQuestionDetector } from "../hooks/useQuestionDetector";
import { QuestionBanner } from "../components/question/QuestionBanner";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

// Component wrapper for testing useQuestionDetector hook
function TestQuestionDetectorComponent({
  onQuestionDetected,
  onDeepSolve,
  allowCandidate,
}: {
  onQuestionDetected?: () => void;
  onDeepSolve?: () => void;
  allowCandidate?: boolean;
}) {
  const { isEvaluating, activeQuestion, triggerDeepSolve } = useQuestionDetector({
    onQuestionDetected,
    onDeepSolve,
    allowCandidate,
  });

  return (
    <div>
      <div data-testid="is-evaluating">{String(isEvaluating)}</div>
      <div data-testid="has-active-question">{String(Boolean(activeQuestion))}</div>
      {activeQuestion && <QuestionBanner />}
      <input data-testid="test-input" placeholder="Type here..." />
      <button data-testid="manual-trigger-btn" onClick={() => triggerDeepSolve()}>
        Manual Trigger
      </button>
    </div>
  );
}

describe("Task 11: Real-Time Question Extractor & Quick Pointers Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().clearSession();
    useSettingsStore.setState({
      apiKeys: {
        openrouter: "",
        anthropic: "",
        openai: "",
        gemini: "",
        groq: "",
        deepgram: "",
      },
      evaluatorModel: "groq/llama-3.3-70b-versatile",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Filler Stripping & Cleaning (REQ-011)", () => {
    it("strips conversational filler from brief prompt simulation", () => {
      const input =
        "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?";
      const cleaned = stripFillerWords(input);

      expect(cleaned).toBe(
        "How would you design a distributed cache to handle hot keys?"
      );
    });

    it("strips conversational phrases like 'can you hear me' and 'so basically'", () => {
      const input =
        "Can you hear me? Uh, so basically, what are the trade-offs between SQL and NoSQL?";
      const cleaned = stripFillerWords(input);

      expect(cleaned).toBe("What are the trade-offs between SQL and NoSQL?");
    });

    it("strips leading filler sounds and words ('um', 'uh', 'like', 'well', 'you know')", () => {
      expect(stripFillerWords("Um, how does Raft handle leader election?")).toBe(
        "How does Raft handle leader election?"
      );
      expect(
        stripFillerWords("Like, so, walk me through your concurrency model.")
      ).toBe("Walk me through your concurrency model.");
      expect(
        stripFillerWords("Well, you know, could you implement an LRU cache?")
      ).toBe("Could you implement an LRU cache?");
    });

    it("strips trailing conversational tags (e.g., ', you know?')", () => {
      const input = "How would you handle network partitions, you know?";
      const cleaned = stripFillerWords(input);
      expect(cleaned).toBe("How would you handle network partitions?");
    });

    it("preserves clean questions that have no filler words", () => {
      const input = "What is the time complexity of quicksort in the worst case?";
      expect(stripFillerWords(input)).toBe(input);
    });

    it("ensures interrogative questions end with a question mark if missing", () => {
      const input = "so basically how would you scale a postgres database";
      expect(stripFillerWords(input)).toBe("How would you scale a postgres database?");
    });
  });

  describe("2. Intent Classification & Confidence Scoring (REQ-011, AC-004)", () => {
    it("accurately classifies interrogative intent with high confidence (>= 0.7)", () => {
      const result = classifyQuestionIntent(
        "How would you design a rate limiter for a multi-tenant API?"
      );

      expect(result.isQuestion).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.extractedQuestion).toContain("How would you design a rate limiter");
      expect(result.quickPointers.length).toBeGreaterThanOrEqual(3);
    });

    it("scores non-question pleasantries and small talk below 0.7 confidence", () => {
      const pleasantries = [
        "Sounds good, let's begin.",
        "Thanks, that makes sense.",
        "Okay cool, let's move on.",
        "Understood, thank you.",
        "Yes, absolutely.",
      ];

      for (const phrase of pleasantries) {
        const result = classifyQuestionIntent(phrase);
        expect(result.isQuestion).toBe(false);
        expect(result.confidence).toBeLessThan(0.7);
      }
    });

    it("generates 3-4 domain-specific quick pointers for distributed cache", () => {
      const pointers = generateQuickPointers("How would you design a distributed cache?");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.length).toBeLessThanOrEqual(4);
      expect(pointers.some((p) => p.toLowerCase().includes("consistent hashing"))).toBe(true);
      expect(pointers.some((p) => p.toLowerCase().includes("l1"))).toBe(true);
    });

    it("generates 3-4 domain-specific quick pointers for rate limiter", () => {
      const pointers = generateQuickPointers("Design a rate limiter for API gateway");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.some((p) => p.toLowerCase().includes("token bucket"))).toBe(true);
      expect(pointers.some((p) => p.toLowerCase().includes("redis"))).toBe(true);
    });

    it("generates 3-4 domain-specific quick pointers for consensus algorithms", () => {
      const pointers = generateQuickPointers("Explain how Raft consensus works");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.some((p) => p.toLowerCase().includes("leader election"))).toBe(true);
    });

    it("returns null in mockEvaluateQuestion when text is not a question", () => {
      const payload = mockEvaluateQuestion("Nice to meet you today!");
      expect(payload).toBeNull();
    });

    it("returns valid QuestionDetectionPayload in mockEvaluateQuestion for valid question", () => {
      const payload = mockEvaluateQuestion(
        "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?"
      );

      expect(payload).not.toBeNull();
      expect(payload?.extracted_question).toBe(
        "How would you design a distributed cache to handle hot keys?"
      );
      expect(payload?.confidence).toBeGreaterThanOrEqual(0.7);
      expect(payload?.quick_pointers.length).toBeGreaterThanOrEqual(3);
      expect(payload?.question_id).toBeDefined();
      expect(payload?.timestamp).toBeGreaterThan(0);
    });
  });

  describe("3. Groq LPU API Integration & Fallback Engine", () => {
    it("calls Groq completions endpoint with JSON format when API key is provided", async () => {
      const mockGroqResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                is_question: true,
                confidence: 0.96,
                extracted_question: "How would you design a distributed cache?",
                quick_pointers: [
                  "Consistent hashing for partitioned distribution",
                  "Local LRU L1 cache + Redis L2 cluster",
                  "Salted keys for hot partition mitigation",
                ],
              }),
            },
          },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockGroqResponse,
      } as Response);

      const payload = await detectQuestion("How would you design a distributed cache?", {
        apiKey: "gsk_test_key_12345",
        model: "groq/llama-3.3-70b-versatile",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callArgs = fetchSpy.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.groq.com/openai/v1/chat/completions");

      const requestBody = JSON.parse(callArgs[1]?.body as string);
      expect(requestBody.model).toBe("llama-3.3-70b-versatile");
      expect(requestBody.response_format).toEqual({ type: "json_object" });

      expect(payload).not.toBeNull();
      expect(payload?.confidence).toBe(0.96);
      expect(payload?.extracted_question).toBe("How would you design a distributed cache?");
      expect(payload?.quick_pointers).toHaveLength(3);
    });

    it("falls back gracefully to offline mock evaluator if Groq API call fails or times out", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network offline"));

      const payload = await detectQuestion(
        "Um, yeah, how would you design a distributed cache to handle hot keys?",
        {
          apiKey: "gsk_invalid_key",
        }
      );

      // Successfully falls back and returns extracted question
      expect(payload).not.toBeNull();
      expect(payload?.extracted_question).toBe(
        "How would you design a distributed cache to handle hot keys?"
      );
      expect(payload?.confidence).toBeGreaterThanOrEqual(0.7);
      expect(payload?.quick_pointers.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("4. QuestionBanner UI Component (REQ-011, REQ-012)", () => {
    it("renders extracted question, confidence badge, bullet points, and Deep Solve pill in HUD mode", () => {
      useSessionStore.getState().setActiveQuestion({
        questionId: "q_cache_test",
        timestamp: Date.now(),
        confidence: 0.95,
        rawTranscript: "How would you design a distributed cache?",
        extractedQuestion: "How would you design a distributed cache to handle hot keys?",
        quickPointers: [
          "Consistent hashing with virtual nodes",
          "Local in-memory L1 cache (Caffeine/LRU)",
          "Key salting and read replicas for hot keys",
        ],
      });

      render(<QuestionBanner variant="hud" />);

      // Extracted question title
      expect(screen.getByText("Live Detected Question")).toBeDefined();
      expect(
        screen.getByText("How would you design a distributed cache to handle hot keys?")
      ).toBeDefined();

      // Confidence badge
      expect(screen.getByText("Confidence: 95%")).toBeDefined();

      // Quick bullet points
      expect(screen.getByText("Consistent hashing with virtual nodes")).toBeDefined();
      expect(
        screen.getByText("Key salting and read replicas for hot keys")
      ).toBeDefined();

      // Action pill: Deep Solve (Enter)
      const deepSolveBtn = screen.getByTestId("deep-solve-btn");
      expect(deepSolveBtn).toBeDefined();
      expect(screen.getByText("Deep Solve (Enter)")).toBeDefined();
    });

    it("renders appropriately in Notch variant with compact styling and match percentage", () => {
      useSessionStore.getState().setActiveQuestion({
        questionId: "q_notch_test",
        timestamp: Date.now(),
        confidence: 0.92,
        rawTranscript: "What is Raft consensus?",
        extractedQuestion: "Explain the Raft consensus algorithm",
        quickPointers: ["Leader election", "Log replication", "Heartbeats"],
      });

      render(<QuestionBanner variant="notch" testId="notch-question-card" />);

      expect(screen.getByTestId("notch-question-card")).toBeDefined();
      expect(screen.getByText("Detected Question")).toBeDefined();
      expect(screen.getByText("92% Match")).toBeDefined();
      expect(screen.getByText("Explain the Raft consensus algorithm")).toBeDefined();
      expect(screen.getByText("Leader election")).toBeDefined();
      expect(screen.getByTestId("deep-solve-btn")).toBeDefined();
    });

    it("triggers onDeepSolve callback and dispatches custom event when Deep Solve button is clicked", () => {
      const handleDeepSolve = vi.fn();
      const domEventSpy = vi.fn();
      window.addEventListener("sidekick:deep_solve", domEventSpy);

      useSessionStore.getState().setActiveQuestion({
        questionId: "q_click_test",
        timestamp: Date.now(),
        confidence: 0.98,
        rawTranscript: "How would you design a rate limiter?",
        extractedQuestion: "How would you design a rate limiter for multi-tenant API?",
        quickPointers: ["Token bucket", "Redis Lua script"],
      });

      render(<QuestionBanner onDeepSolve={handleDeepSolve} />);

      const deepSolveBtn = screen.getByTestId("deep-solve-btn");
      fireEvent.click(deepSolveBtn);

      expect(handleDeepSolve).toHaveBeenCalledTimes(1);
      expect(domEventSpy).toHaveBeenCalledTimes(1);

      window.removeEventListener("sidekick:deep_solve", domEventSpy);
    });

    it("dismisses question and clears activeQuestion when dismiss button is clicked", () => {
      useSessionStore.getState().setActiveQuestion({
        questionId: "q_dismiss",
        timestamp: Date.now(),
        confidence: 0.85,
        rawTranscript: "test question",
        extractedQuestion: "Is this dismissible?",
        quickPointers: ["Point 1"],
      });

      render(<QuestionBanner />);

      expect(useSessionStore.getState().activeQuestion).not.toBeNull();
      const dismissBtn = screen.getByTestId("dismiss-question-btn");
      fireEvent.click(dismissBtn);

      expect(useSessionStore.getState().activeQuestion).toBeNull();
    });
  });

  describe("5. useQuestionDetector Hook & Speech Ingestion Pipeline (REQ-008, REQ-011)", () => {
    it("subscribes to Channel 0 (Interviewer) turns and detects question automatically", async () => {
      const onDetected = vi.fn();
      render(<TestQuestionDetectorComponent onQuestionDetected={onDetected} />);

      expect(screen.getByTestId("has-active-question").textContent).toBe("false");

      // Simulate incoming turn from Channel 0 (Interviewer)
      await act(async () => {
        useSessionStore.getState().addTranscriptTurn({
          speaker: "interviewer",
          text: "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?",
          timestamp: Date.now(),
        });
      });

      // Assert activeQuestion was set and callback was called
      expect(useSessionStore.getState().activeQuestion).not.toBeNull();
      expect(
        useSessionStore.getState().activeQuestion?.extractedQuestion
      ).toBe("How would you design a distributed cache to handle hot keys?");
      expect(screen.getByTestId("has-active-question").textContent).toBe("true");
      expect(onDetected).toHaveBeenCalledTimes(1);
    });

    it("ignores candidate speech turns (Channel 1) from triggering question detection", async () => {
      const onDetected = vi.fn();
      render(<TestQuestionDetectorComponent onQuestionDetected={onDetected} />);

      await act(async () => {
        useSessionStore.getState().addTranscriptTurn({
          speaker: "candidate",
          text: "How about we use a Redis cluster with consistent hashing?",
          timestamp: Date.now(),
        });
      });

      // Channel 1 turns MUST NOT trigger question detection when candidate detection is off
      expect(useSessionStore.getState().activeQuestion).toBeNull();
      expect(onDetected).not.toHaveBeenCalled();
    });

    it("evaluates candidate turns when allowCandidate is true (pill mode / copilot testing)", async () => {
      const onDetected = vi.fn();
      render(<TestQuestionDetectorComponent onQuestionDetected={onDetected} allowCandidate={true} />);

      await act(async () => {
        useSessionStore.getState().addTranscriptTurn({
          speaker: "candidate",
          text: "How would you design a distributed cache to handle hot keys?",
          timestamp: Date.now(),
        });
      });

      // Channel 1 turns DO trigger question detection when allowCandidate is true
      expect(useSessionStore.getState().activeQuestion).not.toBeNull();
      expect(
        useSessionStore.getState().activeQuestion?.extractedQuestion
      ).toBe("How would you design a distributed cache to handle hot keys?");
      expect(onDetected).toHaveBeenCalledTimes(1);
    });

    it("triggers Deep Solve when pressing Enter hotkey while question is active", () => {
      const onDeepSolve = vi.fn();
      render(<TestQuestionDetectorComponent onDeepSolve={onDeepSolve} />);

      act(() => {
        useSessionStore.getState().setActiveQuestion({
          questionId: "q_enter_test",
          timestamp: Date.now(),
          confidence: 0.95,
          rawTranscript: "Design rate limiter",
          extractedQuestion: "Design rate limiter",
          quickPointers: ["Token bucket"],
        });
      });

      // Press Enter
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(onDeepSolve).toHaveBeenCalledTimes(1);
    });

    it("triggers Deep Solve when pressing Cmd+Enter / Ctrl+Enter", () => {
      const onDeepSolve = vi.fn();
      render(<TestQuestionDetectorComponent onDeepSolve={onDeepSolve} />);

      act(() => {
        useSessionStore.getState().setActiveQuestion({
          questionId: "q_cmd_enter_test",
          timestamp: Date.now(),
          confidence: 0.95,
          rawTranscript: "Design rate limiter",
          extractedQuestion: "Design rate limiter",
          quickPointers: ["Token bucket"],
        });
      });

      // Press Cmd+Enter
      fireEvent.keyDown(window, { key: "Enter", code: "Enter", metaKey: true });
      expect(onDeepSolve).toHaveBeenCalledTimes(1);
    });

    it("does not hijack plain Enter when an input element is focused", () => {
      const onDeepSolve = vi.fn();
      render(<TestQuestionDetectorComponent onDeepSolve={onDeepSolve} />);

      act(() => {
        useSessionStore.getState().setActiveQuestion({
          questionId: "q_input_test",
          timestamp: Date.now(),
          confidence: 0.95,
          rawTranscript: "Design rate limiter",
          extractedQuestion: "Design rate limiter",
          quickPointers: ["Token bucket"],
        });
      });

      const input = screen.getByTestId("test-input");
      input.focus();

      // Plain Enter inside input: should NOT trigger Deep Solve
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      expect(onDeepSolve).not.toHaveBeenCalled();

      // Cmd+Enter inside input: SHOULD trigger Deep Solve
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", metaKey: true });
      expect(onDeepSolve).toHaveBeenCalledTimes(1);
    });
  });

  describe("6. End-to-End Simulation Verification (Task Brief Scenario)", () => {
    it("simulates brief transcript and verifies QuestionBanner renders in < 1s with extracted question and bullet points", async () => {
      const startTime = performance.now();

      render(<TestQuestionDetectorComponent />);

      // Simulate incoming transcript turn from Channel 0 (Interviewer)
      await act(async () => {
        useSessionStore.getState().addTranscriptTurn({
          speaker: "interviewer",
          text: "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?",
          timestamp: Date.now(),
        });
      });

      const elapsedMs = performance.now() - startTime;
      // Verification: QuestionBanner pops up in < 1000ms (AC-004)
      expect(elapsedMs).toBeLessThan(1000);

      // Verify QuestionBanner content
      expect(
        screen.getByText("How would you design a distributed cache to handle hot keys?")
      ).toBeDefined();
      expect(screen.getByText("Deep Solve (Enter)")).toBeDefined();

      const pointers = screen.getByTestId("question-pointers");
      expect(pointers.children.length).toBeGreaterThanOrEqual(3);
    });
  });
});
