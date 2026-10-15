import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../store/appStore";

describe("App", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.75,
      isClickThrough: false,
      isVisible: true,
      isPanicked: false,
    });
  });

  it("renders HUDContainer when layoutMode is floating_hud", () => {
    useAppStore.setState({ layoutMode: "floating_hud" });
    render(<App />);

    expect(screen.getByTestId("hud-container")).toBeDefined();
    expect(screen.queryByTestId("notch-companion")).toBeNull();

    const root = screen.getByTestId("app-root");
    expect(root.className).toContain("items-center justify-center");
    // Web fallback opacity is applied when outside native Tauri
    expect(root.style.opacity).toBe("0.75");
  });

  it("renders NotchCompanion when layoutMode is dynamic_notch", () => {
    useAppStore.setState({ layoutMode: "dynamic_notch" });
    render(<App />);

    expect(screen.getByTestId("notch-companion")).toBeDefined();
    expect(screen.queryByTestId("hud-container")).toBeNull();

    const root = screen.getByTestId("app-root");
    expect(root.className).toContain("items-start justify-center");
  });
});
