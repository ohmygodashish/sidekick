import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, setupAppEventListeners, toggleMeeting, submitTypedAsk, runAssist, STOP_FAILED_MESSAGE } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import * as ipc from "../lib/ipc";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.85,
      isClickThrough: false,
      isVisible: false,
      isPanicked: false,
      meetingStatus: "idle",
      meetingStartedAt: null,
      meetingError: null,
      isAskOpen: false,
    });
  });

  describe("meeting start/stop", () => {
    it("does not record until the user starts a meeting, then stops cleanly", async () => {
      expect(useAppStore.getState().meetingStatus).toBe("idle");

      await useAppStore.getState().startMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("live");
      expect(useAppStore.getState().meetingStartedAt).toEqual(expect.any(Number));

      await useAppStore.getState().stopMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("idle");
      expect(useAppStore.getState().meetingStartedAt).toBeNull();
    });

    it("panic ends the meeting", async () => {
      await useAppStore.getState().startMeeting();
      await useAppStore.getState().triggerPanic();
      expect(useAppStore.getState().meetingStatus).toBe("idle");
    });

  });

  it("should have expected default state", () => {
    const state = useAppStore.getState();
    expect(state.layoutMode).toBe("floating_hud");
    expect(state.opacity).toBe(0.85);
    expect(state.isClickThrough).toBe(false);
    expect(state.isVisible).toBe(false);
    expect(state.isPanicked).toBe(false);
  });

  it("should update and toggle layout mode", async () => {
    await useAppStore.getState().setLayoutMode("dynamic_notch");
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");

    await useAppStore.getState().toggleLayoutMode();
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");

    await useAppStore.getState().toggleLayoutMode();
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");
  });

  it("should clamp opacity between 0.15 and 1.0", async () => {
    await useAppStore.getState().setOpacity(0.5);
    expect(useAppStore.getState().opacity).toBe(0.5);

    // Below minimum
    await useAppStore.getState().setOpacity(0.05);
    expect(useAppStore.getState().opacity).toBe(0.15);

    // Above maximum
    await useAppStore.getState().setOpacity(1.5);
    expect(useAppStore.getState().opacity).toBe(1.0);
  });

  it("should toggle and set click-through mode", async () => {
    await useAppStore.getState().setClickThrough(true);
    expect(useAppStore.getState().isClickThrough).toBe(true);

    await useAppStore.getState().toggleClickThrough();
    expect(useAppStore.getState().isClickThrough).toBe(false);
  });

  it("should handle panic trigger", async () => {
    useAppStore.setState({ isVisible: true, isPanicked: false });

    await useAppStore.getState().triggerPanic();
    expect(useAppStore.getState().isPanicked).toBe(true);
    expect(useAppStore.getState().isVisible).toBe(false);
  });

  describe("toggleMeeting (Shift + Cmd + \\)", () => {
    it("starts when idle, stops when live, and ignores starting and stopping", async () => {
      await toggleMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("live");

      await toggleMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("idle");

      useAppStore.setState({ meetingStatus: "starting" });
      await toggleMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("starting");

      useAppStore.setState({ meetingStatus: "stopping" });
      await toggleMeeting();
      expect(useAppStore.getState().meetingStatus).toBe("stopping");
    });
  });

  it("maps the toggle_meeting, open_settings and new_chat events to their actions", async () => {
    const handlers = new Map<string, (event: any) => void>();
    vi.doMock("@tauri-apps/api/event", () => ({
      listen: vi.fn(async (eventName: string, handler: (e: any) => void) => {
        handlers.set(eventName, handler);
        return () => handlers.delete(eventName);
      }),
    }));

    useSettingsStore.setState({ isSettingsOpen: false });
    useSessionStore.getState().beginMessage({ question: "Explain Raft", kind: "typed", newThread: true });
    useSessionStore.setState({ askDraft: "half typed", pickedOption: "An option" });
    useAppStore.setState({ isAskOpen: false, meetingStatus: "idle" });

    const unlisten = await setupAppEventListeners();

    handlers.get("sidekick://open_settings")!({ payload: {} });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    // New chat ends the thread (it stays in history) and leaves Ask open and empty
    handlers.get("sidekick://new_chat")!({ payload: {} });
    expect(useSessionStore.getState().activeThreadId).toBeNull();
    expect(useSessionStore.getState().threads).toHaveLength(1);
    expect(useSessionStore.getState().askDraft).toBe("");
    expect(useSessionStore.getState().pickedOption).toBeNull();
    expect(useAppStore.getState().isAskOpen).toBe(true);

    handlers.get("sidekick://toggle_meeting")!({ payload: {} });
    await vi.waitFor(() => expect(useAppStore.getState().meetingStatus).toBe("live"));

    unlisten();
    vi.doUnmock("@tauri-apps/api/event");
  });

  it("should setup event listeners and unlisten without throwing", async () => {
    const unlisten = await setupAppEventListeners();
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
  });

  it("should clear sessionStore on sidekick://session_burned event", async () => {
    const eventHandlers = new Map<string, (event: any) => void>();
    const { vi } = await import("vitest");
    const { useSessionStore } = await import("../store/sessionStore");

    vi.doMock("@tauri-apps/api/event", () => ({
      listen: vi.fn(async (eventName: string, handler: (e: any) => void) => {
        eventHandlers.set(eventName, handler);
        return () => eventHandlers.delete(eventName);
      }),
    }));

    useSessionStore.getState().addTranscriptTurn({
      speaker: "interviewer",
      text: "Explain Paxos consensus",
      timestamp: 12345,
    });
    expect(useSessionStore.getState().transcript.length).toBeGreaterThan(0);

    await useAppStore.getState().startMeeting();
    const unlisten = await setupAppEventListeners();
    const burnedHandler = eventHandlers.get("sidekick://session_burned");
    expect(burnedHandler).toBeDefined();
    burnedHandler!({ payload: {} });
    expect(useSessionStore.getState().transcript.length).toBe(0);
    expect(useSessionStore.getState().threads).toHaveLength(0);
    // burn_session stops audio capture in Rust, so the meeting must end too
    expect(useAppStore.getState().meetingStatus).toBe("idle");
    unlisten();
    vi.doUnmock("@tauri-apps/api/event");
  });

  it("a partial start stays live with its warnings, and a failed stop says so", async () => {
    const spy = vi
      .spyOn(ipc, "invokeInTauri")
      .mockResolvedValueOnce(["System audio is off: Screen Recording isn't allowed."]);

    await useAppStore.getState().startMeeting();
    expect(useAppStore.getState().meetingStatus).toBe("live");
    expect(useAppStore.getState().meetingError).toBe("System audio is off: Screen Recording isn't allowed.");

    spy.mockRejectedValueOnce(new Error("lock poisoned"));
    await useAppStore.getState().stopMeeting();
    expect(useAppStore.getState().meetingStatus).toBe("live");
    expect(useAppStore.getState().meetingError).toBe(STOP_FAILED_MESSAGE);
    spy.mockRestore();
  });

  describe("chat history and Assist", () => {
    const seed = () => useSessionStore.getState().beginMessage({ question: "Explain Raft", kind: "typed", newThread: true });

    beforeEach(() => {
      useSessionStore.getState().clearSession();
      useSessionStore.setState({ askDraft: "", askUsesScreen: true, optionsUseScreen: false });
      useSettingsStore.setState({ isSettingsOpen: false });
    });

    it("a successful stop clears this meeting's history", async () => {
      await useAppStore.getState().startMeeting();
      seed();

      await useAppStore.getState().stopMeeting();

      expect(useSessionStore.getState().threads).toHaveLength(0);
      expect(useSessionStore.getState().activeThreadId).toBeNull();
    });

    it("a failed stop keeps the history", async () => {
      await useAppStore.getState().startMeeting();
      seed();
      const spy = vi.spyOn(ipc, "invokeInTauri").mockRejectedValueOnce(new Error("lock poisoned"));

      await useAppStore.getState().stopMeeting();

      expect(useSessionStore.getState().threads).toHaveLength(1);
      spy.mockRestore();
    });

    it("panic clears the history", async () => {
      seed();
      await useAppStore.getState().triggerPanic();
      expect(useSessionStore.getState().threads).toHaveLength(0);
    });

    it("Ask submits the typed question into the thread and closes Ask", () => {
      useAppStore.setState({ isAskOpen: true });
      useSessionStore.setState({ askDraft: "  How would you shard it?  " });
      const listener = vi.fn();
      window.addEventListener("sidekick:deep_solve", listener);

      submitTypedAsk();

      window.removeEventListener("sidekick:deep_solve", listener);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        question: "How would you shard it?",
        kind: "typed",
        captureWindow: true,
      });
      expect(useSessionStore.getState().askDraft).toBe("");
      expect(useAppStore.getState().isAskOpen).toBe(false);
    });

    it("Assist starts a new thread labelled as the assist question, with the screen on", () => {
      seed();
      useSessionStore.setState({ pickedOption: "An option the user picked" });
      useAppStore.setState({ layoutMode: "dynamic_notch", isAskOpen: true });
      useSettingsStore.setState({ isSettingsOpen: true });
      const listener = vi.fn();
      window.addEventListener("sidekick:deep_solve", listener);

      runAssist();

      window.removeEventListener("sidekick:deep_solve", listener);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        kind: "assist",
        newThread: true,
        captureWindow: true,
      });
      expect(useAppStore.getState().layoutMode).toBe("floating_hud");
      expect(useAppStore.getState().isAskOpen).toBe(false);
      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
      expect(useSessionStore.getState().pickedOption).toBeNull();
    });

    it("sidekick://assist sends a typed follow-up whenever its box is showing, otherwise runs Assist", async () => {
      const handlers = new Map<string, (event: any) => void>();
      vi.doMock("@tauri-apps/api/event", () => ({
        listen: vi.fn(async (eventName: string, handler: (e: any) => void) => {
          handlers.set(eventName, handler);
          return () => handlers.delete(eventName);
        }),
      }));
      const kinds: string[] = [];
      const record = (e: Event) => kinds.push((e as CustomEvent).detail.kind);
      window.addEventListener("sidekick:deep_solve", record);

      const unlisten = await setupAppEventListeners();
      const assistKey = () => handlers.get("sidekick://assist")!({ payload: {} });

      // Ask open with text: the typed follow-up is sent and the box clears
      useAppStore.setState({ isAskOpen: true });
      useSessionStore.setState({ askDraft: "Typed follow-up" });
      assistKey();
      expect(kinds).toEqual(["typed"]);
      expect(useSessionStore.getState().askDraft).toBe("");

      // Ask open but empty: Assist
      assistKey();
      expect(kinds).toEqual(["typed", "assist"]);

      // Ask closed, but a chat is open so its follow-up box is showing: the text is sent
      useAppStore.setState({ isAskOpen: false });
      useSessionStore.getState().beginMessage({ question: "Open chat", kind: "typed", newThread: true });
      useSessionStore.setState({ askDraft: "Follow-up in an open chat" });
      assistKey();
      expect(kinds).toEqual(["typed", "assist", "typed"]);

      // No box showing: Assist, and the text stays in the draft
      useSessionStore.getState().clearAnswer();
      useSessionStore.setState({ askDraft: "Not sent" });
      assistKey();
      expect(kinds).toEqual(["typed", "assist", "typed", "assist"]);
      expect(useSessionStore.getState().askDraft).toBe("Not sent");

      window.removeEventListener("sidekick:deep_solve", record);
      unlisten();
      vi.doUnmock("@tauri-apps/api/event");
    });
  });

  // Keep last: it resets the module registry.
  it("calls the backend inside Tauri and reports a refused start", async () => {
    vi.resetModules();
    // Only the first start is refused; other commands (settings hydration runs on import) succeed
    let refuseStart = true;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "start_audio_capture" && refuseStart) {
        refuseStart = false;
        throw "Screen Recording permission denied";
      }
      return null;
    });
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
    const { useAppStore: store } = await import("../store/appStore");

    await store.getState().startMeeting();
    expect(invoke).toHaveBeenCalledWith("start_audio_capture", { config: null });
    expect(store.getState().meetingStatus).toBe("idle");
    expect(store.getState().meetingError).toContain("permission");

    await store.getState().startMeeting();
    expect(store.getState().meetingStatus).toBe("live");
    expect(store.getState().meetingError).toBeNull();

    vi.doUnmock("@tauri-apps/api/core");
    vi.resetModules();
  });
});
