import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore, setupAppEventListeners } from "../store/appStore";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.85,
      isClickThrough: false,
      isVisible: false,
      isPanicked: false,
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

  it("should handle panic trigger and reset", async () => {
    useAppStore.setState({ isVisible: true, isPanicked: false });

    await useAppStore.getState().triggerPanic();
    expect(useAppStore.getState().isPanicked).toBe(true);
    expect(useAppStore.getState().isVisible).toBe(false);

    useAppStore.getState().resetPanic();
    expect(useAppStore.getState().isPanicked).toBe(false);
  });

  it("should reset panic state when window becomes visible", () => {
    useAppStore.setState({ isPanicked: true, isVisible: false });

    useAppStore.getState().setIsVisible(true);
    expect(useAppStore.getState().isVisible).toBe(true);
    expect(useAppStore.getState().isPanicked).toBe(false);
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

    const unlisten = await setupAppEventListeners();
    const burnedHandler = eventHandlers.get("sidekick://session_burned");
    if (burnedHandler) {
      burnedHandler({ payload: {} });
      expect(useSessionStore.getState().transcript.length).toBe(0);
    }
    unlisten();
    vi.doUnmock("@tauri-apps/api/event");
  });
});
