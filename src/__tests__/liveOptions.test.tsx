import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  fetchLiveOptions,
  formatTranscript,
  liveOptionsErrorMessage,
  sanitizeOptions,
} from "../services/ai/liveOptions";
import { ProviderHttpError } from "../services/ai/errors";
import { buildOptions, pickLiveOption, useLiveOptions } from "../hooks/useLiveOptions";
import { LiveOptions } from "../components/hud/LiveOptions";
import { CaptionLine } from "../components/hud/CaptionLine";
import { useSessionStore, TranscriptTurn } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";

const turn = (speaker: TranscriptTurn["speaker"], text: string, id = `t_${Math.random()}`): TranscriptTurn => ({
  id,
  speaker,
  text,
  timestamp: Date.now(),
});

function groqResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

const setGroqKey = (groq: string) =>
  useSettingsStore.setState((s) => ({ apiKeys: { ...s.apiKeys, groq }, evaluatorModel: "groq/qwen/qwen3.8-27b" }));

function HookHost() {
  useLiveOptions();
  return null;
}

beforeEach(() => {
  useSessionStore.getState().clearSession();
  useAppStore.setState({ meetingStatus: "live", layoutMode: "floating_hud", isAskOpen: false, sttError: null });
  useSettingsStore.setState({ isSettingsOpen: false });
  setGroqKey("");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live options service", () => {
  it("keeps at most one asked and three distinct likely questions", () => {
    expect(
      sanitizeOptions({
        asked: "  How do you find a cycle?  ",
        likely: ["how do you find a cycle?", "BFS vs DFS?", 42, "", "BFS vs  DFS?", "Dijkstra?", "Topo sort?", "Extra?"],
      })
    ).toEqual({ asked: "How do you find a cycle?", likely: ["BFS vs DFS?", "Dijkstra?", "Topo sort?"] });
    expect(sanitizeOptions({ asked: "", likely: "nope" })).toEqual({ asked: null, likely: [] });
    expect(sanitizeOptions(null)).toEqual({ asked: null, likely: [] });
  });

  it("without a Groq key, spots a question locally and predicts nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const asked = await fetchLiveOptions([turn("interviewer", "Um, so how would you detect a cycle in a graph?")]);
    expect(asked).toEqual({ asked: "How would you detect a cycle in a graph?", likely: [] });
    expect(await fetchLiveOptions([turn("candidate", "How would I do that?")])).toEqual({ asked: null, likely: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks Groq with the transcript as data and parses JSON after a think block", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(groqResponse('<think>graphs {maybe}</think>{"asked": null, "likely": ["BFS vs DFS?"]}'));

    const result = await fetchLiveOptions([turn("interviewer", "We use graphs a lot.")], {
      apiKey: "gsk-test",
      model: "groq/qwen/qwen3.8-27b",
    });

    expect(result).toEqual({ asked: null, likely: ["BFS vs DFS?"] });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.messages[1].content).toBe("<transcript>\nInterviewer: We use graphs a lot.\n</transcript>");
  });

  it("maps Groq failures to a short reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 401 }));
    const err = await fetchLiveOptions([turn("interviewer", "Hi")], { apiKey: "gsk-bad" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(liveOptionsErrorMessage(err)).toBe("Groq rejected the API key. Check it in Settings → Keys.");
    expect(liveOptionsErrorMessage(new Error("boom"))).toBe("Live options are unavailable right now.");
  });

  it("formats only the last 12 turns", () => {
    const turns = Array.from({ length: 15 }, (_, i) => turn(i % 2 ? "candidate" : "interviewer", `line ${i}`));
    const lines = formatTranscript(turns).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("Candidate: line 3");
  });
});

describe("useLiveOptions", () => {
  it("puts the asked question first, then likely ones, three at most", () => {
    expect(buildOptions("Asked?", ["A?", "B?", "C?"])).toEqual([
      { text: "Asked?", asked: true },
      { text: "A?", asked: false },
      { text: "B?", asked: false },
    ]);
    expect(buildOptions(null, ["A?"])).toEqual([{ text: "A?", asked: false }]);
  });

  it("updates options per turn and keeps the asked question pinned until the next one", async () => {
    setGroqKey("gsk-test");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(groqResponse('{"asked": "How do you detect a cycle?", "likely": ["A?", "B?"]}'))
      .mockResolvedValueOnce(groqResponse('{"asked": null, "likely": ["C?", "D?"]}'));
    render(<HookHost />);

    await act(async () => useSessionStore.getState().addTranscriptTurn(turn("interviewer", "How do you detect a cycle?")));
    expect(useSessionStore.getState().askedQuestion).toBe("How do you detect a cycle?");

    await act(async () => useSessionStore.getState().addTranscriptTurn(turn("candidate", "I'd use DFS with colours.")));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().askedQuestion).toBe("How do you detect a cycle?");
    expect(useSessionStore.getState().likelyQuestions).toEqual(["C?", "D?"]);
  });

  it("runs one request at a time and reruns once for turns that arrive meanwhile", async () => {
    setGroqKey("gsk-test");
    let release!: (r: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
      .mockResolvedValue(groqResponse('{"asked": null, "likely": ["Latest?"]}'));
    render(<HookHost />);

    act(() => {
      useSessionStore.getState().addTranscriptTurn(turn("interviewer", "one"));
      useSessionStore.getState().addTranscriptTurn(turn("candidate", "two"));
      useSessionStore.getState().addTranscriptTurn(turn("interviewer", "three"));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => release(groqResponse('{"asked": null, "likely": ["Stale?"]}')));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const rerunBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(rerunBody.messages[1].content).toContain("Interviewer: three");
    expect(useSessionStore.getState().likelyQuestions).toEqual(["Latest?"]);
  });

  it("shows a reason and keeps old options when a request fails", async () => {
    setGroqKey("gsk-test");
    useSessionStore.setState({ likelyQuestions: ["Old?"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429 }));
    render(<HookHost />);

    await act(async () => useSessionStore.getState().addTranscriptTurn(turn("interviewer", "Next topic.")));
    expect(useSessionStore.getState().optionsError).toBe("Groq is rate-limiting live options. They'll resume shortly.");
    expect(useSessionStore.getState().likelyQuestions).toEqual(["Old?"]);
  });

  it("picking an option solves it with the conversation as context", () => {
    useSessionStore.getState().addTranscriptTurn(turn("interviewer", "We use graphs."));
    useSessionStore.setState({ askedQuestion: null, likelyQuestions: ["BFS vs DFS?", "Dijkstra?"] });
    useSettingsStore.setState({ isSettingsOpen: true });
    useAppStore.setState({ layoutMode: "dynamic_notch" });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);

    pickLiveOption(1);
    pickLiveOption(5); // no such slot: ignored

    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.extractedQuestion).toBe("Dijkstra?");
    expect(detail.rawTranscript).toBe("Interviewer: We use graphs.");
    expect(useSessionStore.getState().pickedOption).toBe("Dijkstra?");
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");
  });
});

describe("LiveOptions and CaptionLine", () => {
  it("render nothing unless a meeting is live", () => {
    useAppStore.setState({ meetingStatus: "idle" });
    useSessionStore.setState({ likelyQuestions: ["A?"] });
    render(
      <>
        <LiveOptions />
        <CaptionLine />
      </>
    );
    expect(screen.queryByTestId("live-options")).toBeNull();
    expect(screen.queryByTestId("caption-line")).toBeNull();
  });

  it("lists numbered options, marks the asked one, and solves on click", () => {
    setGroqKey("gsk-test");
    useSessionStore.setState({ askedQuestion: "How do you detect a cycle?", likelyQuestions: ["BFS vs DFS?"] });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<LiveOptions />);

    expect(screen.getByText("⌘⌥1")).toBeDefined();
    expect(screen.getByText("Asked")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /BFS vs DFS/ }));

    window.removeEventListener("sidekick:deep_solve", listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.extractedQuestion).toBe("BFS vs DFS?");
  });

  it("explains what's missing when there are no options yet", () => {
    const { rerender } = render(<LiveOptions />);
    expect(screen.getByText("Add a Groq key in Settings → Keys to see likely questions.")).toBeDefined();
    setGroqKey("gsk-test");
    rerender(<LiveOptions />);
    expect(screen.getByText("Questions appear here as the conversation goes.")).toBeDefined();
  });

  it("captions system audio and the mic on separate lines, plus any transcription error", () => {
    const { rerender } = render(<CaptionLine />);
    expect(screen.getAllByText("Listening…")).toHaveLength(2);

    act(() => {
      useSessionStore.getState().addTranscriptTurn(turn("interviewer", "Tell me about graphs."));
      useSessionStore.getState().addTranscriptTurn(turn("candidate", "Sure, mostly BFS."));
      useSessionStore.getState().addTranscriptTurn(turn("interviewer", "And cycles?"));
    });
    rerender(<CaptionLine />);
    expect(screen.getByText("System").parentElement?.textContent).toBe("System · And cycles?");
    expect(screen.getByText("Microphone").parentElement?.textContent).toBe("Microphone · Sure, mostly BFS.");

    act(() => useAppStore.setState({ sttError: { message: "Groq rejected the API key.", recovered: false } }));
    rerender(<CaptionLine />);
    expect(screen.getByText("Groq rejected the API key.")).toBeDefined();
    expect(screen.getByText("System")).toBeDefined();
  });
});
