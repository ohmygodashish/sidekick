import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayoutSwitcher } from "../components/hud/LayoutSwitcher";
import { useAppStore } from "../store/appStore";

describe("LayoutSwitcher", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "floating_hud",
    });
  });

  it("renders with HUD active and toggles to Notch", () => {
    render(<LayoutSwitcher />);

    const btn = screen.getByTestId("layout-switcher");
    expect(btn).toBeDefined();
    expect(screen.getByText("HUD")).toBeDefined();
    expect(screen.getByText("⌘⇧M")).toBeDefined();

    fireEvent.click(btn);
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");
    expect(screen.getByText("Notch")).toBeDefined();
  });

  it("supports compact mode without hotkey label", () => {
    useAppStore.setState({ layoutMode: "dynamic_notch" });
    render(<LayoutSwitcher compact showHotkey={false} />);

    const btn = screen.getByTestId("layout-switcher");
    expect(btn.className).toContain("text-[10px]");
    expect(screen.queryByText("⌘⇧M")).toBeNull();
  });
});
