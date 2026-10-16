import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, setupAppEventListeners, toggleMeeting } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

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
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_2",
      timestamp: 2000,
      confidence: 1,
      rawTranscript: "Explain Raft",
      extractedQuestion: "Explain Raft",
      quickPointers: [],
    });
    useAppStore.setState({ isAskOpen: true, meetingStatus: "idle" });

    const unlisten = await setupAppEventListeners();

    handlers.get("sidekick://open_settings")!({ payload: {} });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    handlers.get("sidekick://new_chat")!({ payload: {} });
    expect(useSessionStore.getState().activeQuestion).toBeNull();
    expect(useAppStore.getState().isAskOpen).toBe(false);

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
    // burn_session stops audio capture in Rust, so the meeting must end too
    expect(useAppStore.getState().meetingStatus).toBe("idle");
    unlisten();
    vi.doUnmock("@tauri-apps/api/event");
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
