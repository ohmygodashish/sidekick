import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.75,
      isClickThrough: false,
      isVisible: true,
      isPanicked: false,
      meetingStatus: "idle",
      meetingStartedAt: null,
      meetingError: null,
    });
    useSettingsStore.getState().resetSettings();
    useSettingsStore.setState({ isSettingsOpen: false });
  });

  it("renders the control bar", () => {
    render(<App />);

    expect(screen.getByRole("toolbar", { name: "Sidekick controls" })).toBeDefined();
    // Web fallback opacity is applied when outside native Tauri
    expect(screen.getByTestId("app-root").style.opacity).toBe("0.75");
  });

  it("toggles settings when pressing Cmd + ,", () => {
    render(<App />);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it("invokes loadApiKeysFromBackend on initial mount", () => {
    const loadSpy = vi.spyOn(useSettingsStore.getState(), "loadApiKeysFromBackend");
    render(<App />);
    expect(loadSpy).toHaveBeenCalled();
  });
});
