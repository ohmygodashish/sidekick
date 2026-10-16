import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../store/sessionStore";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it("should have initial empty session state", () => {
    const state = useSessionStore.getState();
    expect(state.transcript).toEqual([]);
    expect(state.activeQuestion).toBeNull();
    expect(state.stage1Intuition).toBeNull();
    expect(state.stage2Code).toBeNull();
    expect(state.stage3Analysis).toBeNull();
    expect(state.activeSolutionProvider).toBeNull();
    expect(state.activeSolutionModel).toBeNull();
  });

  it("should add transcript turns with auto-generated id", () => {
    useSessionStore.getState().addTranscriptTurn({
      speaker: "interviewer",
      text: "Can you explain how you would design a rate limiter?",
      timestamp: 1000,
    });

    useSessionStore.getState().addTranscriptTurn({
      speaker: "candidate",
      text: "Sure, I would use a sliding window counter algorithm.",
      timestamp: 2000,
    });

    const turns = useSessionStore.getState().transcript;
    expect(turns.length).toBe(2);
    expect(turns[0].speaker).toBe("interviewer");
    expect(turns[0].text).toContain("rate limiter");
    expect(turns[0].id).toBeDefined();
    expect(turns[1].speaker).toBe("candidate");
  });

  it("should set active question from standard schema", () => {
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_101",
      timestamp: 1729000000000,
      confidence: 0.98,
      rawTranscript: "How would you design a rate limiter?",
      extractedQuestion: "Design a distributed rate limiter",
      quickPointers: ["Token Bucket", "Redis sliding window", "Lua atomic check"],
    });

    const q = useSessionStore.getState().activeQuestion;
    expect(q).not.toBeNull();
    expect(q?.questionId).toBe("q_101");
    expect(q?.confidence).toBe(0.98);
    expect(q?.extractedQuestion).toBe("Design a distributed rate limiter");
    expect(q?.quickPointers).toHaveLength(3);
  });

  it("should parse active question from snake_case backend event schema", () => {
    useSessionStore.getState().setActiveQuestion({
      question_id: "q_202",
      timestamp: 1729000050000,
      confidence: 0.95,
      raw_transcript: "Can you implement LRU cache?",
      extracted_question: "Implement LRU Cache",
      quick_pointers: ["Doubly linked list", "HashMap O(1) get/put"],
    });

    const q = useSessionStore.getState().activeQuestion;
    expect(q).not.toBeNull();
    expect(q?.questionId).toBe("q_202");
    expect(q?.extractedQuestion).toBe("Implement LRU Cache");
    expect(q?.quickPointers).toEqual(["Doubly linked list", "HashMap O(1) get/put"]);
  });

  it("should set progressive solution stages matching spec §4.2", () => {
    useSessionStore.getState().setSolution({
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      stage_1_intuition: {
        verbal_summary: "Use Redis sliding window counter",
        key_tradeoffs: ["Memory efficiency", "Atomic script"],
      },
      stage_2_code: {
        language: "python",
        code: "class RateLimiter: ...",
        explanation: "Atomic check and increment",
      },
      stage_3_analysis: {
        time_complexity: "O(1)",
        space_complexity: "O(N)",
        edge_cases: ["Clock drift", "Redis failover"],
      },
    });

    const state = useSessionStore.getState();
    expect(state.activeSolutionProvider).toBe("anthropic");
    expect(state.activeSolutionModel).toBe("claude-3-5-sonnet");
    expect(state.stage1Intuition?.verbalSummary).toBe("Use Redis sliding window counter");
    expect(state.stage1Intuition?.keyTradeoffs).toHaveLength(2);
    expect(state.stage2Code?.language).toBe("python");
    expect(state.stage3Analysis?.timeComplexity).toBe("O(1)");
    expect(state.stage3Analysis?.edgeCases).toContain("Clock drift");
    expect(state.progressiveSolution).not.toBeNull();
    expect(state.progressiveSolution?.stage1Intuition?.verbalSummary).toBe(
      "Use Redis sliding window counter"
    );
    expect(state.progressiveSolution?.stage2Code?.language).toBe("python");
    expect(state.progressiveSolution?.stage3Analysis?.timeComplexity).toBe("O(1)");
  });

  it("should clear session completely", () => {
    useSessionStore.getState().addTranscriptTurn({
      speaker: "interviewer",
      text: "Test turn",
      timestamp: 1234,
    });
    useSessionStore.getState().setSolution({
      stage_1_intuition: { verbal_summary: "Test summary", key_tradeoffs: [] },
    });

    expect(useSessionStore.getState().transcript.length).toBe(1);
    expect(useSessionStore.getState().stage1Intuition).not.toBeNull();

    useSessionStore.getState().clearSession();

    expect(useSessionStore.getState().transcript.length).toBe(0);
    expect(useSessionStore.getState().stage1Intuition).toBeNull();
  });
});

describe("clearAnswer", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it("clears the answer on screen and cancels a running solve, but keeps the transcript", () => {
    const cancel = vi.fn();
    window.addEventListener("sidekick:cancel_solve", cancel);

    const store = useSessionStore.getState();
    store.addTranscriptTurn({ speaker: "interviewer", text: "Explain Paxos.", timestamp: 1000 });
    store.setActiveQuestion({
      questionId: "q_1",
      timestamp: 1000,
      confidence: 1,
      rawTranscript: "Explain Paxos.",
      extractedQuestion: "Explain Paxos",
      quickPointers: [],
    });
    store.setSolution({
      questionId: "q_1",
      stage1Intuition: { verbalSummary: "Quorums", keyTradeoffs: [] },
      stage2Code: null,
      stage3Analysis: null,
    });
    useSessionStore.setState({ solveError: "Timed out", pickedOption: "Explain Paxos" });

    useSessionStore.getState().clearAnswer();

    const state = useSessionStore.getState();
    expect(state.activeQuestion).toBeNull();
    expect(state.stage1Intuition).toBeNull();
    expect(state.stage2Code).toBeNull();
    expect(state.stage3Analysis).toBeNull();
    expect(state.progressiveSolution).toBeNull();
    expect(state.solveError).toBeNull();
    expect(state.pickedOption).toBeNull();
    expect(state.transcript).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);

    window.removeEventListener("sidekick:cancel_solve", cancel);
  });
});
