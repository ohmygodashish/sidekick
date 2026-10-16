import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import * as dispatcherModule from "../services/ai/dispatcher";
import type { DispatchOptions } from "../services/ai/dispatcher";
import { useDeepSolver } from "../hooks/useDeepSolver";
import { pickLiveOption } from "../hooks/useLiveOptions";
import {
  useSessionStore,
  activeThreadOf,
  requestSolve,
  ProgressiveSolution,
  STOPPED_MESSAGE,
  ThreadMessage,
} from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { ASSIST_LABEL } from "../services/ai/promptTemplates";

const DEBOUNCE_MS = 400;

interface Call {
  options: DispatchOptions;
  resolve: (solution: ProgressiveSolution) => void;
  reject: (err: unknown) => void;
}

// Each dispatch stays open until the test answers it, as a provider stream does
let calls: Call[] = [];
function holdDispatches() {
  calls = [];
  vi.spyOn(dispatcherModule, "dispatchDeepSolve").mockImplementation(
    (options) =>
      new Promise<ProgressiveSolution>((resolve, reject) => {
        calls.push({ options, resolve, reject });
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
  );
}

const solution = (summary: string): ProgressiveSolution => ({
  stage1Intuition: { verbalSummary: summary, keyTradeoffs: [] },
  stage2Code: null,
  stage3Analysis: null,
});

const lastMessage = (): ThreadMessage => {
  const messages = activeThreadOf(useSessionStore.getState())?.messages ?? [];
  return messages[messages.length - 1];
};
const summaryOf = (message?: ThreadMessage) => message?.solution?.stage1Intuition?.verbalSummary;

// Runs an update, lets the timers it starts run for `advanceMs`, then lets the promise chains settle
const settle = (update: () => unknown, advanceMs = 0) =>
  act(async () => {
    update();
    await vi.advanceTimersByTimeAsync(advanceMs);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

// A question as the options card sets it: its prefetch starts once the window closes
const ask = (question: string) => settle(() => useSessionStore.setState({ askedQuestion: question }), DEBOUNCE_MS);
const askWithoutWait = (question: string) => settle(() => useSessionStore.setState({ askedQuestion: question }));
const pick = () => settle(() => pickLiveOption(0));
const mount = () => render(<Host />);

function Host() {
  useDeepSolver();
  return null;
}

beforeEach(() => {
  // Only the timers the prefetch uses are faked; Date.now stays real for the solver's duplicate guard
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  useSessionStore.getState().clearSession();
  useSessionStore.setState({ optionsUseScreen: false, askUsesScreen: true, askDraft: "" });
  useAppStore.setState({
    isPanicked: false,
    isVisible: true,
    isAskOpen: false,
    layoutMode: "floating_hud",
    meetingStatus: "live",
  });
  useSettingsStore.setState((s) => ({
    selectedProvider: "openrouter",
    selectedModels: { openrouter: "anthropic/claude-haiku-5.5", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
    activeModeId: "general",
    modes: [],
    outputLanguage: "English",
    answerThinking: true,
    answerThinkingLevel: "medium",
    pickThinking: false,
    apiKeys: { ...s.apiKeys, openrouter: "sk-or-test" },
  }));
  holdDispatches();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("slot-1 prefetch", () => {
  it("starts once per new asked question, with no message and no solving state", async () => {
    mount();
    await ask("How do you detect a cycle?");
    expect(calls).toHaveLength(1);

    // The same question in other case and spacing keeps the running prefetch
    await ask("  how do you DETECT a cycle? ");
    expect(calls).toHaveLength(1);
    expect(calls[0].options.signal?.aborted).toBe(false);

    expect(useSessionStore.getState().threads).toEqual([]);
    expect(useSessionStore.getState().solvingMessageId).toBeNull();
  });

  it("starts 400 ms after the question settles, not before", async () => {
    mount();
    await askWithoutWait("How do you detect a cycle?");
    await settle(() => {}, DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);

    await settle(() => {}, 1);
    expect(calls).toHaveLength(1);
  });

  it("a change within the window restarts the timer, so only the last question is sent", async () => {
    mount();
    await askWithoutWait("First reworded?");
    await settle(() => {}, 300);
    await askWithoutWait("Second reworded?");
    await settle(() => {}, 300);
    expect(calls).toHaveLength(0);

    await settle(() => {}, 100);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.prompt).toContain('"Second reworded?"');
    expect(calls[0].options.prompt).not.toContain("First reworded?");
  });

  it("a question cleared before the window closes is never sent", async () => {
    mount();
    await askWithoutWait("How do you detect a cycle?");
    await settle(() => useSessionStore.getState().clearSession());
    await settle(() => {}, DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("answers the conversation as it stood when the question settled, without the screen", async () => {
    useSessionStore.getState().addTranscriptTurn({ speaker: "interviewer", text: "We use graphs a lot.", timestamp: 1 });
    mount();
    await ask("How do you detect a cycle?");

    expect(calls[0].options.prompt).toContain("Interviewer: We use graphs a lot.");
    expect(calls[0].options.prompt).toContain('"How do you detect a cycle?"');
    expect(calls[0].options.imageBase64).toBeUndefined();
  });

  it("a new asked question aborts the running prefetch and replaces it", async () => {
    mount();
    await ask("First question?");
    await ask("Second question?");

    expect(calls).toHaveLength(2);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.signal?.aborted).toBe(false);
    expect(calls[1].options.prompt).toContain('"Second question?"');
  });

  it("does not prefetch while the options' screen is on, and stops one when the screen turns on", async () => {
    mount();
    useSessionStore.setState({ optionsUseScreen: true });
    await ask("Screen question?");
    expect(calls).toHaveLength(0);

    // Turning the screen off prefetches the question on screen once the window closes
    await settle(() => useSessionStore.setState({ optionsUseScreen: false }), DEBOUNCE_MS);
    expect(calls).toHaveLength(1);

    await settle(() => useSessionStore.setState({ optionsUseScreen: true }));
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it("turning the screen off prefetches the question on screen, only after the window closes", async () => {
    mount();
    useSessionStore.setState({ optionsUseScreen: true });
    await ask("Screen question?");

    await settle(() => useSessionStore.setState({ optionsUseScreen: false }));
    expect(calls).toHaveLength(0);
    await settle(() => {}, DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.prompt).toContain('"Screen question?"');
  });

  it("does not prefetch once panicked", async () => {
    mount();
    useAppStore.setState({ isPanicked: true });
    await ask("How do you detect a cycle?");
    expect(calls).toHaveLength(0);
  });

  it("does not prefetch unless the meeting is live, and a screen-off restart obeys the same rule", async () => {
    mount();
    useAppStore.setState({ meetingStatus: "idle" });
    await ask("How do you detect a cycle?");
    expect(calls).toHaveLength(0);

    useSessionStore.setState({ optionsUseScreen: true });
    await settle(() => useSessionStore.setState({ optionsUseScreen: false }), DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("a late options answer after Stop starts nothing, and a pending start is cancelled by Stop", async () => {
    mount();
    await ask("How do you detect a cycle?");
    expect(calls).toHaveLength(1);

    // Stop: the meeting goes idle and the chats end, which discards the running prefetch
    await settle(() => {
      useAppStore.setState({ meetingStatus: "idle" });
      useSessionStore.getState().clearThreads();
    });
    expect(calls[0].options.signal?.aborted).toBe(true);

    // The options card's late answer sets the question again: nothing is sent while idle
    await ask("Late question?");
    expect(calls).toHaveLength(1);
  });

  it("Stop cancels a start that is still waiting out the window", async () => {
    mount();
    await askWithoutWait("How do you detect a cycle?");
    await settle(() => useSessionStore.getState().clearThreads());
    await settle(() => {}, DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("a finished prefetch answers a pick at once, with no request", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => calls[0].resolve(solution("Use fast and slow pointers.")));

    await pick();

    expect(calls).toHaveLength(1);
    expect(lastMessage()).toMatchObject({ question: "How do you detect a cycle?", kind: "option", viewedScreen: false });
    expect(summaryOf(lastMessage())).toBe("Use fast and slow pointers.");
    expect(useSessionStore.getState().solvingMessageId).toBeNull();
  });

  it("a pick while the prefetch runs shows its text so far, then streams the rest into the same message", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => calls[0].options.onProgressiveUpdate?.(solution("Use fast")));

    await pick();
    const message = lastMessage();
    expect(summaryOf(message)).toBe("Use fast");
    expect(useSessionStore.getState().solvingMessageId).toBe(message.id);

    await settle(() => calls[0].options.onProgressiveUpdate?.(solution("Use fast and slow pointers.")));
    expect(lastMessage().id).toBe(message.id);
    expect(summaryOf(lastMessage())).toBe("Use fast and slow pointers.");

    await settle(() => calls[0].resolve(solution("Use fast and slow pointers.")));
    expect(useSessionStore.getState().solvingMessageId).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("a pick of another question runs its own solve and leaves the prefetch running", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() =>
      requestSolve({ question: "Explain Dijkstra?", kind: "option", newThread: true, captureWindow: false })
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].options.prompt).toContain('"Explain Dijkstra?"');
    expect(calls[0].options.signal?.aborted).toBe(false);

    await settle(() => calls[0].resolve(solution("Two pointers.")));
    await pick();
    expect(calls).toHaveLength(2);
    expect(summaryOf(lastMessage())).toBe("Two pointers.");
  });

  it("a failed prefetch is ignored: the pick runs a normal solve", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => calls[0].reject(new Error("Groq is down")));

    await pick();

    expect(calls).toHaveLength(2);
    expect(calls[1].options.reasoning).toBe("none");
    expect(lastMessage()).toMatchObject({ question: "How do you detect a cycle?", kind: "option" });
    expect(useSessionStore.getState().solvingMessageId).toBe(lastMessage().id);
  });

  it("a picked prefetch is used once: picking the same question again solves it", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => calls[0].resolve(solution("Use fast and slow pointers.")));
    await pick();
    expect(calls).toHaveLength(1);

    // The solver ignores repeat requests for 500 ms
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    await pick();
    expect(calls).toHaveLength(2);
    expect(calls[1].options.reasoning).toBe("none");
  });

  it("a solve that adopts a running prefetch is superseded like any other, keeping its partial answer", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => calls[0].options.onProgressiveUpdate?.(solution("Partial")));
    await pick();
    const picked = lastMessage().id;

    await settle(() => requestSolve({ question: "A harder one?", captureWindow: false }));

    expect(calls[0].options.signal?.aborted).toBe(true);
    const stopped = activeThreadOf(useSessionStore.getState())!.messages.find((m) => m.id === picked);
    expect(stopped).toMatchObject({ error: STOPPED_MESSAGE });
    expect(summaryOf(stopped)).toBe("Partial");
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["Stop", () => useSessionStore.getState().clearThreads()],
    ["panic", () => useAppStore.getState().triggerPanic()],
    ["Burn", () => useSessionStore.getState().clearSession()],
  ])("%s discards the prefetch", async (_name, end) => {
    mount();
    await ask("How do you detect a cycle?");
    await act(async () => {
      await end();
    });
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it.each([
    ["the mode", () => useSettingsStore.getState().setActiveMode("behavioral")],
    ["the output language", () => useSettingsStore.getState().setOutputLanguage("French")],
    ["the provider", () => useSettingsStore.getState().setSelectedProvider("anthropic")],
    ["the model", () => useSettingsStore.getState().setProviderModel("openrouter", "anthropic/claude-sonnet-5.5")],
    ["the resume or seniority", () => useSettingsStore.getState().setSeniority("staff")],
  ])("a change of %s discards the prefetch", async (_name, change) => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(change);
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it("a change of a model the active provider doesn't use keeps the prefetch", async () => {
    mount();
    await ask("How do you detect a cycle?");
    await settle(() => useSettingsStore.getState().setProviderModel("openai", "gpt-6.1-sol"));
    expect(calls[0].options.signal?.aborted).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("a change of the thinking level restarts the prefetch at the new level", async () => {
    useSettingsStore.setState({ pickThinking: true });
    mount();
    await ask("How do you detect a cycle?");
    expect(calls[0].options.reasoning).toBe("medium");

    await settle(() => useSettingsStore.getState().setAnswerThinkingLevel("high"), DEBOUNCE_MS);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].options.reasoning).toBe("high");
  });

  it("turning thinking off restarts the prefetch when picks think, so the restart stops thinking", async () => {
    useSettingsStore.setState({ pickThinking: true });
    mount();
    await ask("How do you detect a cycle?");

    await settle(() => useSettingsStore.getState().setAnswerThinking(false), DEBOUNCE_MS);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.reasoning).toBe("none");
  });

  it("turning the picks switch on restarts the prefetch at the level", async () => {
    mount();
    await ask("How do you detect a cycle?");
    expect(calls[0].options.reasoning).toBe("none");

    await settle(() => useSettingsStore.getState().setPickThinking(true), DEBOUNCE_MS);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.reasoning).toBe("medium");
  });

  it("a level change that picks do not use leaves the prefetch running", async () => {
    mount();
    await ask("How do you detect a cycle?");

    await settle(() => useSettingsStore.getState().setAnswerThinkingLevel("high"), DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.signal?.aborted).toBe(false);
  });

  it("a change of output language restarts the prefetch for the question on screen", async () => {
    mount();
    await ask("How do you detect a cycle?");

    await settle(() => useSettingsStore.getState().setOutputLanguage("French"), DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.systemSuffix).toContain("Write every answer in French");
    expect(calls[1].options.prompt).toContain('"How do you detect a cycle?"');
  });

  it("editing the active custom mode's prompt discards the prefetch and restarts it with the new prompt", async () => {
    const id = useSettingsStore.getState().addMode("Brief", "Answer in one line.");
    useSettingsStore.getState().setActiveMode(id);
    mount();
    await ask("How do you detect a cycle?");
    expect(calls[0].options.systemSuffix).toContain("Answer in one line.");

    // The id stays the same, so only the modes list tells the prefetch the prompt changed
    await settle(() => useSettingsStore.getState().updateMode(id, { prompt: "Answer with a table." }), DEBOUNCE_MS);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].options.systemSuffix).toContain("Answer with a table.");
    expect(calls[1].options.systemSuffix).not.toContain("Answer in one line.");
  });

  it("unmounting the solver discards the prefetch", async () => {
    const view = mount();
    await ask("How do you detect a cycle?");
    await settle(() => view.unmount());
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it("sends the system prompt in two parts, with the mode and language after the profile", async () => {
    useSettingsStore.setState({ activeModeId: "behavioral", outputLanguage: "French" });
    mount();
    await ask("Tell me about a conflict?");

    const options = calls[0].options;
    expect(options.systemPrompt).toBeUndefined();
    expect(options.systemPrefix).toContain("PERSONALIZATION DIRECTIVES");
    expect(options.systemPrefix).not.toContain("### MODE");
    expect(options.systemSuffix).toContain("### MODE");
    expect(options.systemSuffix).toContain("Write every answer in French");
  });
});

describe("reasoning per answer", () => {
  const pickRequest = () => requestSolve({ question: "Pick?", kind: "option", newThread: true, captureWindow: false });
  const typedRequest = () => requestSolve({ question: "Typed?", kind: "typed", captureWindow: false });
  const assistRequest = () =>
    requestSolve({ question: ASSIST_LABEL, kind: "assist", newThread: true, captureWindow: false });
  const prefetchAsk = () => useSessionStore.setState({ askedQuestion: "Prefetch?" });

  // With thinking off the picks switch does nothing; with it on, picks think only when their own switch is on
  const OFF = { answerThinking: false, pickThinking: true };
  const ON_PICKS_OFF = { answerThinking: true, pickThinking: false };
  const ON_PICKS_ON = { answerThinking: true, pickThinking: true };

  it.each([
    ["a typed question with thinking off", OFF, typedRequest, "none"],
    ["Assist with thinking off", OFF, assistRequest, "none"],
    ["an option pick with thinking off", OFF, pickRequest, "none"],
    ["the slot-1 prefetch with thinking off", OFF, prefetchAsk, "none"],
    ["a typed question with picks off", ON_PICKS_OFF, typedRequest, "medium"],
    ["Assist with picks off", ON_PICKS_OFF, assistRequest, "medium"],
    ["an option pick with picks off", ON_PICKS_OFF, pickRequest, "none"],
    ["the slot-1 prefetch with picks off", ON_PICKS_OFF, prefetchAsk, "none"],
    ["a typed question with picks on", ON_PICKS_ON, typedRequest, "medium"],
    ["Assist with picks on", ON_PICKS_ON, assistRequest, "medium"],
    ["an option pick with picks on", ON_PICKS_ON, pickRequest, "medium"],
    ["the slot-1 prefetch with picks on", ON_PICKS_ON, prefetchAsk, "medium"],
  ])("%s", async (_name, settings, start, expected) => {
    useSettingsStore.setState(settings);
    mount();
    await settle(start, DEBOUNCE_MS);

    expect(calls[calls.length - 1].options.reasoning).toBe(expected);
  });

  it.each(["low", "medium", "high"] as const)(
    "the %s level reaches option picks and the slot-1 prefetch once picks are on",
    async (level) => {
      useSettingsStore.setState({ ...ON_PICKS_ON, answerThinkingLevel: level });
      mount();
      await settle(prefetchAsk, DEBOUNCE_MS);
      expect(calls[0].options.reasoning).toBe(level);

      await settle(pickRequest);
      expect(calls[calls.length - 1].options.reasoning).toBe(level);
    }
  );

  it("the mode no longer decides: Coding picks think only when the picks switch is on", async () => {
    useSettingsStore.setState({ ...ON_PICKS_OFF, activeModeId: "coding" });
    mount();
    await settle(pickRequest);

    expect(calls[calls.length - 1].options.reasoning).toBe("none");
  });
});
