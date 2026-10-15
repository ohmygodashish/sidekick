import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HUDContainer } from "../components/hud/HUDContainer";
import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";

describe("HUDContainer", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.85,
      isClickThrough: false,
      isVisible: true,
      isPanicked: false,
    });
    useSessionStore.getState().clearSession();
  });

  it("renders with draggable header bar containing data-tauri-drag-region", () => {
    render(<HUDContainer />);

    const header = screen.getByTestId("hud-header");
    expect(header).toBeDefined();
    expect(header.getAttribute("data-tauri-drag-region")).not.toBeNull();
    expect(screen.getByText("Sidekick")).toBeDefined();
    expect(screen.getByText("Invisible")).toBeDefined();
  });

  it("toggles click-through state when clicking click-through button", () => {
    render(<HUDContainer />);

    const clickThroughBtn = screen.getByTitle(/Toggle Mouse Click-Through/i);
    expect(useAppStore.getState().isClickThrough).toBe(false);

    fireEvent.click(clickThroughBtn);
    expect(useAppStore.getState().isClickThrough).toBe(true);

    fireEvent.click(clickThroughBtn);
    expect(useAppStore.getState().isClickThrough).toBe(false);
  });

  it("toggles layout mode between floating HUD and dynamic notch", () => {
    render(<HUDContainer />);

    const layoutBtn = screen.getByTitle(/Toggle Floating HUD \/ Dynamic Notch/i);
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");

    fireEvent.click(layoutBtn);
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");

    fireEvent.click(layoutBtn);
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");
  });

  it("triggers panic mode and renders panic alert banner", () => {
    render(<HUDContainer />);

    const panicBtn = screen.getByTitle(/Instant Panic Killswitch/i);
    fireEvent.click(panicBtn);

    expect(useAppStore.getState().isPanicked).toBe(true);
    expect(screen.getByText(/Panic Mode Engaged/i)).toBeDefined();
    expect(screen.getByText("Panicked")).toBeDefined();

    // Clicking resume should restore state
    const resumeBtn = screen.getByText("Resume Copilot");
    fireEvent.click(resumeBtn);
    expect(useAppStore.getState().isPanicked).toBe(false);
  });

  it("renders live detected question when available in sessionStore", () => {
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_test",
      timestamp: Date.now(),
      confidence: 0.99,
      rawTranscript: "How does raft consensus work?",
      extractedQuestion: "Explain the Raft consensus algorithm",
      quickPointers: ["Leader election", "Log replication", "Heartbeats"],
    });

    render(<HUDContainer />);

    expect(screen.getByText("Live Detected Question")).toBeDefined();
    expect(screen.getByText("Explain the Raft consensus algorithm")).toBeDefined();
    expect(screen.getByText("Leader election")).toBeDefined();
  });

  it("renders progressive solution stages when present in sessionStore", () => {
    useSessionStore.getState().setSolution({
      stage1Intuition: {
        verbalSummary: "Raft decomposes consensus into leader election and log replication.",
        keyTradeoffs: ["Easier to understand than Paxos"],
      },
      stage2Code: {
        language: "rust",
        code: "fn handle_append_entries() { ... }",
        explanation: "Handles incoming RPCs",
      },
      stage3Analysis: null,
    });

    render(<HUDContainer />);

    expect(screen.getByText("Stage 1: Intuition & Tradeoffs")).toBeDefined();
    expect(
      screen.getByText(/Raft decomposes consensus into leader election/)
    ).toBeDefined();
    expect(screen.getByText("Stage 2: Code (rust)")).toBeDefined();
  });
});
