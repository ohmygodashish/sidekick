import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BarMenu } from "../components/hud/BarMenu";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "More options" }));
const modeItems = () => screen.getAllByRole("menuitemradio");

describe("More options: Mode section", () => {
  beforeEach(() => {
    // Reset keeps custom modes, so clear them here
    useSettingsStore.getState().resetSettings();
    useSettingsStore.setState({ modes: [] });
    useSettingsStore.setState({ isSettingsOpen: false });
    useSessionStore.getState().clearSession();
  });

  it("lists the presets, then custom modes, as radio items with a check on the active one", () => {
    useSettingsStore.getState().addMode("Pair programming", "Think out loud.");
    render(<BarMenu />);
    openMenu();

    expect(modeItems().map((el) => el.textContent)).toEqual([
      "General",
      "Behavioral",
      "Coding",
      "System Design",
      "Pair programming",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "General" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Coding" }).getAttribute("aria-checked")).toBe("false");
    // The section header names the current mode
    expect(screen.getByRole("group", { name: "Mode" }).textContent).toContain("General");
  });

  it("choosing a mode makes it active, closes the menu and turns the screen on for Coding", () => {
    render(<BarMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Coding" }));

    expect(useSettingsStore.getState().activeModeId).toBe("coding");
    expect(useSessionStore.getState().optionsUseScreen).toBe(true);
    expect(screen.getByRole("button", { name: "More options" }).getAttribute("aria-expanded")).toBe("false");

    openMenu();
    expect(screen.getByRole("menuitemradio", { name: "Coding" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("group", { name: "Mode" }).textContent).toContain("Coding");
  });

  it("checks General when the active custom mode no longer exists, matching the header", () => {
    useSettingsStore.setState({ activeModeId: "custom_deleted" });
    render(<BarMenu />);
    openMenu();

    expect(screen.getByRole("menuitemradio", { name: "General" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("group", { name: "Mode" }).textContent).toContain("General");
  });

  it("choosing a custom mode makes it active", () => {
    const id = useSettingsStore.getState().addMode("Pair programming", "Think out loud.");
    render(<BarMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pair programming" }));
    expect(useSettingsStore.getState().activeModeId).toBe(id);
  });

  it("arrow keys move through the mode items too", () => {
    render(<BarMenu />);
    openMenu();
    const press = (key: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key });

    // Opening focuses Compact view; Settings comes right before the Mode section
    press("ArrowDown");
    press("ArrowDown");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));
    press("ArrowDown");
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "General" }));
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "System Design" }));
  });
});
