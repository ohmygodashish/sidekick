import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HUDContainer } from "../components/hud/HUDContainer";
import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

vi.mock("../components/answer/AnswerPanel", () => ({
  AnswerPanel: () => <div data-testid="answer-panel" />,
}));
vi.mock("../components/settings/SettingsDrawer", () => ({
  SettingsDrawer: () => <div data-testid="settings-drawer" />,
}));

const question = {
  questionId: "q_test",
  timestamp: Date.now(),
  confidence: 0.99,
  rawTranscript: "How does raft consensus work?",
  extractedQuestion: "Explain the Raft consensus algorithm",
  quickPointers: ["Leader election", "Log replication"],
};

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "More options" }));

describe("HUDContainer", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
      meetingStatus: "idle",
      meetingStartedAt: null,
      meetingError: null,
      isAskOpen: false,
      isClickThrough: false,
      isPanicked: false,
      isVisible: true,
    });
    useSessionStore.getState().clearSession();
    useSettingsStore.setState({ isSettingsOpen: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the bar with Start, Ask, Hide and More options", () => {
    render(<HUDContainer />);

    expect(screen.getByRole("toolbar", { name: "Sidekick controls" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start listening" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Ask/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Hide/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "More options" })).toBeDefined();
  });

  it("Start goes live, and Stop returns to idle", async () => {
    render(<HUDContainer />);

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    const stop = await screen.findByRole("button", { name: "Stop listening" });
    expect(stop.textContent).toContain("0:00");

    fireEvent.click(stop);
    await waitFor(() => expect(useAppStore.getState().meetingStatus).toBe("idle"));
    expect(screen.getByRole("button", { name: "Start listening" })).toBeDefined();
  });

  it("live timer counts up every second and uses h:mm:ss after an hour", () => {
    vi.useFakeTimers();
    useAppStore.setState({ meetingStatus: "live", meetingStartedAt: Date.now() - 65_000 });
    render(<HUDContainer />);

    const stop = () => screen.getByRole("button", { name: "Stop listening" });
    expect(stop().textContent).toContain("1:05");

    act(() => vi.advanceTimersByTime(2000));
    expect(stop().textContent).toContain("1:07");

    useAppStore.setState({ meetingStartedAt: Date.now() - 3_722_000 });
    act(() => vi.advanceTimersByTime(1000));
    expect(stop().textContent).toContain("1:02:03");
  });

  it("Ask with no detected question opens the answer panel", () => {
    render(<HUDContainer />);

    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
    expect(useAppStore.getState().isAskOpen).toBe(true);
  });

  it("Ask opens the typed question even when a question is active, without solving", () => {
    useSessionStore.getState().setActiveQuestion(question);
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);

    render(<HUDContainer />);
    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));

    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).not.toHaveBeenCalled();
    expect(useAppStore.getState().isAskOpen).toBe(true);
  });

  it("compact view hides the answer panel, and Ask brings it back", () => {
    useAppStore.setState({ layoutMode: "dynamic_notch" });
    render(<HUDContainer />);
    expect(screen.queryByTestId("answer-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");
    expect(screen.getByTestId("answer-panel")).toBeDefined();
  });

  it("settings replace the answer panel, and Ask closes settings", () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(<HUDContainer />);
    expect(screen.getByTestId("settings-drawer")).toBeDefined();
    expect(screen.queryByTestId("answer-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(screen.getByTestId("answer-panel")).toBeDefined();
  });

  it("shows an alert when the meeting failed to start", () => {
    useAppStore.setState({ meetingError: "Permission denied" });
    render(<HUDContainer />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't start listening");
    expect(alert.getAttribute("title")).toBe("Permission denied");
  });

  // The menu plays a short exit before unmounting, so "closed" is the trigger's state
  const expectMenuClosed = () =>
    expect(screen.getByRole("button", { name: "More options" }).getAttribute("aria-expanded")).toBe("false");

  it("More options menu toggles compact view, click-through and settings", () => {
    render(<HUDContainer />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Compact view/ }));
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");
    expectMenuClosed();

    openMenu();
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Compact view/ }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Click-through/ }));
    expect(useAppStore.getState().isClickThrough).toBe(true);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expectMenuClosed();
  });

  it("opening the menu focuses its first item", () => {
    render(<HUDContainer />);
    openMenu();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemcheckbox", { name: /Compact view/ })
    );
  });

  it("arrow keys move focus through the menu items and wrap around", () => {
    render(<HUDContainer />);
    openMenu();
    const compact = screen.getByRole("menuitemcheckbox", { name: /Compact view/ });
    const clickThrough = screen.getByRole("menuitemcheckbox", { name: /Click-through/ });
    const panic = screen.getByRole("menuitem", { name: /Panic/ });
    const press = (key: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key });

    press("ArrowDown");
    expect(document.activeElement).toBe(clickThrough);

    press("ArrowUp");
    expect(document.activeElement).toBe(compact);

    press("ArrowUp");
    expect(document.activeElement).toBe(panic);

    press("ArrowDown");
    expect(document.activeElement).toBe(compact);
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    render(<HUDContainer />);
    const trigger = screen.getByRole("button", { name: "More options" });
    openMenu();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expectMenuClosed();
    expect(document.activeElement).toBe(trigger);
  });

  it("pointer-down outside the menu closes it, and it unmounts after its exit", async () => {
    render(<HUDContainer />);
    openMenu();

    fireEvent.mouseDown(document.body);
    expectMenuClosed();
    expect(screen.getByRole("menu").getAttribute("data-state")).toBe("closed");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
