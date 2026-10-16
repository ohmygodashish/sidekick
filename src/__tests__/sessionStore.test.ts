import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore, requestSolve, activeThreadOf, ProgressiveSolution, STOPPED_MESSAGE } from "../store/sessionStore";

const solution: ProgressiveSolution = {
  stage1Intuition: { verbalSummary: "Use a hash map.", keyTradeoffs: ["O(N) memory"] },
  stage2Code: null,
  stage3Analysis: null,
};

const state = () => useSessionStore.getState();

/** Starts a message the way the solver does and returns its ids */
const begin = (question: string, kind: "typed" | "option" | "assist" = "typed", newThread = false) =>
  state().beginMessage({ question, kind, newThread })!;

describe("useSessionStore", () => {
  beforeEach(() => {
    state().clearSession();
    useSessionStore.setState({ askDraft: "", askUsesScreen: true, optionsUseScreen: false });
  });

  it("should have initial empty session state", () => {
    const s = state();
    expect(s.transcript).toEqual([]);
    expect(s.threads).toEqual([]);
    expect(s.activeThreadId).toBeNull();
    expect(s.solvingMessageId).toBeNull();
  });

  it("screen toggles default to on in the Ask box and off for options, and are session only", () => {
    const fresh = useSessionStore.getInitialState();
    expect(fresh.askUsesScreen).toBe(true);
    expect(fresh.optionsUseScreen).toBe(false);
  });

  it("should add transcript turns with auto-generated id", () => {
    state().addTranscriptTurn({ speaker: "interviewer", text: "Design a rate limiter?", timestamp: 1000 });
    state().addTranscriptTurn({ speaker: "candidate", text: "Sure, sliding window.", timestamp: 2000 });

    const turns = state().transcript;
    expect(turns.length).toBe(2);
    expect(turns[0].speaker).toBe("interviewer");
    expect(turns[0].id).toBeDefined();
    expect(turns[1].speaker).toBe("candidate");
  });

  it("clearSession clears the transcript and every thread", () => {
    state().addTranscriptTurn({ speaker: "interviewer", text: "Test turn", timestamp: 1234 });
    begin("Explain Paxos.");

    state().clearSession();

    expect(state().transcript).toHaveLength(0);
    expect(state().threads).toHaveLength(0);
    expect(state().activeThreadId).toBeNull();
  });
});

describe("threads", () => {
  beforeEach(() => {
    state().clearSession();
  });

  it("a typed Ask continues the active thread, and starts one when there is none", () => {
    const first = begin("Explain Raft.");
    expect(state().threads).toHaveLength(1);
    expect(state().activeThreadId).toBe(first.threadId);

    const second = begin("And leader election?");
    expect(state().threads).toHaveLength(1);
    expect(second.threadId).toBe(first.threadId);
    expect(second.before.map((m) => m.question)).toEqual(["Explain Raft."]);
    expect(activeThreadOf(state())?.messages.map((m) => m.question)).toEqual([
      "Explain Raft.",
      "And leader election?",
    ]);
  });

  it("an option or Assist starts a new thread, newest first", () => {
    const typed = begin("Explain Raft.");
    const option = begin("BFS vs DFS?", "option", true);
    const assist = begin("Help with what's on my screen", "assist", true);

    expect(state().threads.map((t) => t.id)).toEqual([assist.threadId, option.threadId, typed.threadId]);
    expect(assist.before).toEqual([]);
    expect(state().activeThreadId).toBe(assist.threadId);
    expect(state().threads[0].messages[0].kind).toBe("assist");
  });

  it("clearAnswer ends the active thread but keeps it in history", () => {
    const cancel = vi.fn();
    window.addEventListener("sidekick:cancel_solve", cancel);
    begin("Explain Paxos.");

    state().clearAnswer();

    expect(state().activeThreadId).toBeNull();
    expect(state().threads).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    window.removeEventListener("sidekick:cancel_solve", cancel);
  });

  it("a later question after New chat starts a new thread and keeps the old one", () => {
    begin("First chat.");
    state().clearAnswer();
    const next = begin("Second chat.");

    expect(state().threads).toHaveLength(2);
    expect(state().threads[0].id).toBe(next.threadId);
    expect(next.before).toEqual([]);
  });

  it("openThread reopens a past thread and ignores unknown ids", () => {
    const first = begin("First chat.");
    state().clearAnswer();
    begin("Second chat.");

    state().openThread("no-such-thread");
    expect(state().activeThreadId).not.toBe(first.threadId);

    state().openThread(first.threadId);
    expect(state().activeThreadId).toBe(first.threadId);
  });

  it("the solver writes a streamed answer and an error into its own message", () => {
    const { threadId, messageId } = begin("Explain Paxos.");
    state().updateMessage(threadId, messageId, { viewedScreen: true, solution });
    expect(activeThreadOf(state())?.messages[0]).toMatchObject({ viewedScreen: true, solution, error: null });

    state().updateMessage(threadId, messageId, { error: "Timed out" });
    expect(activeThreadOf(state())?.messages[0].error).toBe("Timed out");
  });

  it("a retry reruns the failed message in place with its context", () => {
    const first = begin("First question.");
    state().updateMessage(first.threadId, first.messageId, { solution });
    const failed = begin("Second question.");
    state().updateMessage(failed.threadId, failed.messageId, { error: "Model timed out" });

    const retry = state().beginMessage({
      question: "Second question.",
      kind: "typed",
      newThread: false,
      retryMessageId: failed.messageId,
    });

    expect(retry?.messageId).toBe(failed.messageId);
    expect(retry?.before.map((m) => m.question)).toEqual(["First question."]);
    expect(activeThreadOf(state())?.messages).toHaveLength(2);
    expect(activeThreadOf(state())?.messages[1]).toMatchObject({ error: null, solution: null });
  });

  it("a retry for a message that no longer exists does nothing", () => {
    expect(
      state().beginMessage({ question: "Gone.", kind: "typed", newThread: false, retryMessageId: "msg_missing" })
    ).toBeNull();
    expect(state().threads).toHaveLength(0);
  });

  it("clearThreads empties this meeting's history, cancels a running solve and clears the draft and pick", () => {
    const cancel = vi.fn();
    window.addEventListener("sidekick:cancel_solve", cancel);
    begin("One.");
    state().clearAnswer();
    begin("Two.", "option", true);
    useSessionStore.setState({ solvingMessageId: "msg_x", askDraft: "half typed", pickedOption: "Two." });

    state().clearThreads();

    expect(state().threads).toEqual([]);
    expect(state().activeThreadId).toBeNull();
    expect(state().solvingMessageId).toBeNull();
    expect(state().askDraft).toBe("");
    expect(state().pickedOption).toBeNull();
    expect(cancel).toHaveBeenCalled();
    window.removeEventListener("sidekick:cancel_solve", cancel);
  });

  it("a late write for a cleared chat changes nothing", () => {
    const { threadId, messageId } = begin("Explain Paxos.");
    state().clearThreads();

    state().updateMessage(threadId, messageId, { solution, viewedScreen: true });

    expect(state().threads).toEqual([]);
  });

  it("openThread clears the picked option", () => {
    const first = begin("First chat.");
    state().clearAnswer();
    begin("Second chat.");
    useSessionStore.setState({ pickedOption: "Second chat." });

    state().openThread(first.threadId);

    expect(state().pickedOption).toBeNull();
  });
});

describe("stopMessage", () => {
  const partial: ProgressiveSolution = {
    stage1Intuition: { verbalSummary: "Half an answer.", keyTradeoffs: [] },
    stage2Code: null,
    stage3Analysis: null,
  };

  beforeEach(() => {
    state().clearSession();
  });

  it("keeps a partial answer and says it stopped", () => {
    const { threadId, messageId } = begin("Explain Paxos.");
    state().updateMessage(threadId, messageId, { solution: partial });

    state().stopMessage(threadId, messageId);

    const message = activeThreadOf(state())?.messages[0];
    expect(message?.solution).toEqual(partial);
    expect(message?.error).toBe(STOPPED_MESSAGE);
  });

  it("removes an unanswered follow-up and keeps its chat", () => {
    const first = begin("Explain Raft.");
    state().updateMessage(first.threadId, first.messageId, { solution: partial });
    const follow = begin("And leader election?");

    state().stopMessage(follow.threadId, follow.messageId);

    expect(activeThreadOf(state())?.messages.map((m) => m.question)).toEqual(["Explain Raft."]);
  });

  it("removes a chat that nothing was answered in, so it leaves history", () => {
    const only = begin("Explain Paxos.", "option", true);

    state().stopMessage(only.threadId, only.messageId);

    expect(state().threads).toEqual([]);
    expect(state().activeThreadId).toBeNull();
  });

  it("does nothing for a message that is gone", () => {
    state().stopMessage("thread_missing", "msg_missing");
    expect(state().threads).toEqual([]);
  });
});

describe("requestSolve", () => {
  it("dispatches the solve request as the sidekick:deep_solve event", () => {
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);

    requestSolve({ question: "BFS vs DFS?", kind: "option", newThread: true, captureWindow: false });

    window.removeEventListener("sidekick:deep_solve", listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      question: "BFS vs DFS?",
      kind: "option",
      newThread: true,
      captureWindow: false,
    });
  });
});
