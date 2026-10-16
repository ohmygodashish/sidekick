import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModesTab } from "../components/settings/ModesTab";
import { useSettingsStore } from "../store/settingsStore";

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

describe("Modes tab", () => {
  beforeEach(() => {
    // Reset keeps custom modes, so clear them here
    useSettingsStore.getState().resetSettings();
    useSettingsStore.setState({ modes: [] });
  });

  it("lists the presets read-only with their descriptions", () => {
    render(<ModesTab />);

    expect(screen.getByText("Presets")).toBeDefined();
    expect(screen.getByText("STAR stories: a spoken first-person answer and four talking points.")).toBeDefined();
    expect(screen.getAllByText("Set active")).toHaveLength(3);
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("creates a custom mode from New mode, focusing its name field, and needs a name and prompt", () => {
    render(<ModesTab />);
    fireEvent.click(screen.getByRole("button", { name: /New mode/ }));

    expect(document.activeElement).toBe(field("Name"));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(field("Name"), { target: { value: "Pair programming" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field("Prompt"), { target: { value: "Think out loud and name the invariant." } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    expect(useSettingsStore.getState().modes).toMatchObject([
      { name: "Pair programming", prompt: "Think out loud and name the invariant." },
    ]);
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("Pair programming")).toBeDefined();
  });

  it("edits a custom mode in place and saves the change", () => {
    const id = useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    render(<ModesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(field("Name").value).toBe("Pairing");
    expect(field("Prompt").value).toBe("Think out loud.");

    fireEvent.change(field("Name"), { target: { value: "Pair programming" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useSettingsStore.getState().modes).toEqual([{ id, name: "Pair programming", prompt: "Think out loud." }]);
  });

  it("cancelling an edit leaves the mode as it was", () => {
    useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    render(<ModesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(field("Name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useSettingsStore.getState().modes[0].name).toBe("Pairing");
    expect(screen.getByText("Pairing")).toBeDefined();
  });

  it("deletes a custom mode", () => {
    useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    render(<ModesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(useSettingsStore.getState().modes).toEqual([]);
    expect(screen.queryByText("Pairing")).toBeNull();
  });

  it("sets any mode active and marks it, including a custom one", () => {
    const id = useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    render(<ModesTab />);

    // General is active, so the first "Set active" is Behavioral
    fireEvent.click(screen.getAllByRole("button", { name: "Set active" })[0]);
    expect(useSettingsStore.getState().activeModeId).toBe("behavioral");
    expect(screen.getAllByText("Active")).toHaveLength(1);

    const setActive = screen.getAllByRole("button", { name: "Set active" });
    fireEvent.click(setActive[setActive.length - 1]); // the custom mode, listed last
    expect(useSettingsStore.getState().activeModeId).toBe(id);
    expect(screen.getAllByText("Active")).toHaveLength(1);
  });

  it("keeps unsaved edits: New mode and other Edit buttons wait until the open edit is saved or cancelled", () => {
    useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    useSettingsStore.getState().addMode("Mock interview", "Ask one question at a time.");
    render(<ModesTab />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(field("Name"), { target: { value: "Changed" } });

    expect((screen.getByRole("button", { name: /New mode/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "Edit" })[0] as HTMLButtonElement).disabled).toBe(true);
    expect(field("Name").value).toBe("Changed");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByRole("button", { name: /New mode/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(useSettingsStore.getState().modes[0].name).toBe("Pairing");
  });

  it("does not move focus anywhere unless New mode is clicked", () => {
    useSettingsStore.getState().addMode("Pairing", "Think out loud.");
    render(<ModesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).not.toBe(field("Name"));
  });
});
