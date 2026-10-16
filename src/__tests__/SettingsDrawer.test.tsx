import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { SettingsDrawer } from "../components/settings/SettingsDrawer";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { useAppStore } from "../store/appStore";
import * as ipc from "../lib/ipc";
import { SHORTCUTS } from "../lib/shortcuts";

function providerRow(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("div.rounded-lg") as HTMLElement;
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("SettingsDrawer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetSettings();
    useSessionStore.getState().clearSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("panel shell", () => {
    it("renders nothing when closed", () => {
      const { container } = render(<SettingsDrawer isOpen={false} />);
      expect(container.firstChild).toBeNull();
    });

    it("stays on screen but inert while it plays its exit", () => {
      render(<SettingsDrawer isOpen={true} state="closed" />);

      const dialog = screen.getByRole("dialog", { name: "Settings" });
      expect(dialog.getAttribute("data-state")).toBe("closed");
      expect(dialog.hasAttribute("inert")).toBe(true);
    });

    it("renders an inline dialog with seven tabs, General selected by default", () => {
      render(<SettingsDrawer isOpen={true} />);

      expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual([
        "General",
        "Profile",
        "Modes",
        "Audio",
        "Keybinds",
      ]);
      expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    });

    it("switches tabs and marks the selected one", () => {
      render(<SettingsDrawer isOpen={true} />);

      openTab("Profile");
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("false");
      expect(screen.getByText("Changes save automatically.")).toBeDefined();

      openTab("Audio");
      expect(screen.getByRole("radiogroup", { name: "Speech-to-text engine" })).toBeDefined();

      openTab("General");
      expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeDefined();
    });

    it("moves focus to the selected tab when it opens", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Profile" }));
    });

    it("moves between tabs with the arrow keys", () => {
      render(<SettingsDrawer isOpen={true} />);
      const keysTab = screen.getByRole("tab", { name: "General" });

      fireEvent.keyDown(keysTab, { key: "ArrowRight" });
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(screen.getByRole("tab", { name: "Profile" }), { key: "ArrowLeft" });
      fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowLeft" });
      expect(screen.getByRole("tab", { name: "Keybinds" }).getAttribute("aria-selected")).toBe("true");
    });

    it("closes on the close button", () => {
      const onClose = vi.fn();
      render(<SettingsDrawer isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape but leaves Cmd+Escape for the panic shortcut", () => {
      const onClose = vi.fn();
      render(<SettingsDrawer isOpen={true} onClose={onClose} />);

      fireEvent.keyDown(window, { key: "Escape", metaKey: true });
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes the store-driven panel on Escape", () => {
      useSettingsStore.setState({ isSettingsOpen: true });
      render(<SettingsDrawer />);

      fireEvent.keyDown(window, { key: "Escape" });
      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });

    it("does not show internal spec IDs or implementation names", () => {
      render(<SettingsDrawer isOpen={true} />);

      for (const name of ["General", "Profile", "Modes", "Audio", "Keybinds"]) {
        openTab(name);
        if (name === "General") fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
        expect(screen.getByRole("dialog").textContent).not.toMatch(
          /REQ-|SEC-|ggml|Metal|ScreenCaptureKit|hardware-backed/i
        );
      }
    });

    it("uses theme tokens, not palette colours, on every tab", () => {
      render(<SettingsDrawer isOpen={true} />);
      const palette =
        /(?:^|[\s:])(?:text|bg|ring|border|placeholder|divide|fill)-(?:zinc|sky|red|emerald|amber|orange|slate|gray|white|black)\b/;

      for (const name of ["General", "Profile", "Modes", "Audio", "Keybinds"]) {
        openTab(name);
        if (name === "General") fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
        const offenders = Array.from(screen.getByRole("dialog").querySelectorAll("[class]"))
          .map((el) => el.getAttribute("class") ?? "")
          .filter((cls) => palette.test(cls));
        expect(offenders, `${name} tab`).toEqual([]);
      }
    });
  });

  describe("General tab", () => {
    const solutionModel = () => document.getElementById("solution-model") as HTMLSelectElement;

    beforeEach(() => {
      // Reset settings keeps API keys, so clear them here
      useSettingsStore.setState({ apiKeys: { openrouter: "", anthropic: "", openai: "", groq: "" } });
    });

    it("offers the three solution providers alphabetically, with Groq only as the evaluator key", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const providers = within(screen.getByRole("radiogroup", { name: "Solution models" }))
        .getAllByRole("radio")
        .map((radio) => radio.textContent);
      expect(providers).toEqual(["Anthropic", "OpenAI", "OpenRouter"]);
      expect(screen.getByLabelText("Groq API key").getAttribute("aria-required")).toBe("true");
      expect((document.getElementById("evaluator-model") as HTMLSelectElement).options.length).toBe(1);
      expect(screen.queryByLabelText("Google Gemini API key")).toBeNull();
    });

    it("shows only the chosen provider's card, and its models when OpenAI is chosen", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      expect(screen.queryByRole("heading", { name: "OpenAI" })).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: "OpenAI" }));
      expect(useSettingsStore.getState().selectedProvider).toBe("openai");
      expect(screen.getByRole("heading", { name: "OpenAI" })).toBeDefined();
      expect(screen.queryByRole("heading", { name: "OpenRouter" })).toBeNull();
      expect(Array.from(solutionModel().options).map((o) => o.textContent)).toEqual([
        "GPT-6 Luna",
        "GPT-6.1 Sol · always thinks",
      ]);
    });

    it("saves an edited key on blur, for that provider only", async () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockResolvedValue(undefined);
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      // A blur with no edit saves nothing, so an untouched field can't wipe a stored key
      const groq = screen.getByLabelText("Groq API key");
      await act(async () => {
        fireEvent.blur(groq);
      });
      expect(spyInvoke).not.toHaveBeenCalled();

      const openrouter = screen.getByLabelText("OpenRouter API key");
      fireEvent.change(openrouter, { target: { value: "sk-or-v1-test-key" } });
      expect(spyInvoke).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.blur(openrouter);
      });
      expect(spyInvoke).toHaveBeenCalledTimes(1);
      expect(spyInvoke).toHaveBeenCalledWith("store_api_key", { provider: "openrouter", key: "sk-or-v1-test-key" });
    });

    it("saves a key still being edited when Settings closes", () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockResolvedValue(undefined);
      const { rerender } = render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });

      rerender(<SettingsDrawer isOpen={false} />);
      expect(spyInvoke).toHaveBeenCalledWith("store_api_key", { provider: "groq", key: "gsk_test_key" });
    });

    it("shows a failure under the key when its save is rejected, and clears it on the next edit", async () => {
      vi.spyOn(ipc, "invokeInTauri").mockRejectedValue(new Error("disk full"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      const input = screen.getByLabelText("OpenRouter API key");
      fireEvent.change(input, { target: { value: "sk-or-v1-test-key" } });

      await act(async () => {
        fireEvent.blur(input);
      });
      expect(await screen.findByText("Couldn't save the OpenRouter key. Try again.")).toBeDefined();

      fireEvent.change(input, { target: { value: "sk-or-v1-test-key-2" } });
      expect(screen.queryByText("Couldn't save the OpenRouter key. Try again.")).toBeNull();
    });

    it("retries a key whose save failed when Settings closes", async () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockRejectedValueOnce(new Error("disk full"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { rerender } = render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      const input = screen.getByLabelText("Groq API key");
      fireEvent.change(input, { target: { value: "gsk_test_key" } });
      await act(async () => {
        fireEvent.blur(input);
      });

      spyInvoke.mockResolvedValue(undefined);
      rerender(<SettingsDrawer isOpen={false} />);
      expect(spyInvoke).toHaveBeenCalledTimes(2);
      expect(spyInvoke).toHaveBeenLastCalledWith("store_api_key", { provider: "groq", key: "gsk_test_key" });
    });

    it("says a key is needed when the chosen provider has none, and hides that once one is typed", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      expect(screen.getByText("Add a key to get answers")).toBeDefined();

      fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "sk-or-v1-test-key" } });
      expect(screen.queryByText("Add a key to get answers")).toBeNull();
    });

    it("toggles a key between hidden and visible", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const input = screen.getByLabelText("OpenRouter API key") as HTMLInputElement;
      expect(input.type).toBe("password");

      fireEvent.click(within(providerRow("OpenRouter")).getByRole("button", { name: "Show OpenRouter key" }));
      expect(input.type).toBe("text");

      fireEvent.click(within(providerRow("OpenRouter")).getByRole("button", { name: "Hide OpenRouter key" }));
      expect(input.type).toBe("password");
    });

    it("stores typed keys, and the chosen provider and model", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
        target: { value: "sk-or-v1-test-token-12345" },
      });
      expect(useSettingsStore.getState().apiKeys.openrouter).toBe("sk-or-v1-test-token-12345");

      fireEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
      expect(useSettingsStore.getState().selectedProvider).toBe("anthropic");

      fireEvent.change(solutionModel(), { target: { value: "claude-sonnet-5-5" } });
      expect(useSettingsStore.getState().selectedModels.anthropic).toBe("claude-sonnet-5-5");

      fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
      expect(useSettingsStore.getState().apiKeys.groq).toBe("gsk_test_key");
    });
  });

  describe("answer thinking", () => {
    const thinkingSwitch = () => screen.getByRole("switch", { name: "Think before answering" });
    const pickSwitch = () => screen.getByRole("switch", { name: "Also think for picked options" });
    const levelGroup = () => screen.getByRole("radiogroup", { name: "Thinking level" });

    it("is on at Medium by default, with the picks switch off beneath it", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      expect(thinkingSwitch().tagName).toBe("BUTTON");
      expect(thinkingSwitch().getAttribute("aria-checked")).toBe("true");
      expect(document.getElementById("answer-thinking-help")?.textContent).toBe("Typed questions and ⌘↵ Assist.");
      expect(within(levelGroup()).getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")).toBe("true");
      expect(pickSwitch().getAttribute("aria-checked")).toBe("false");
    });

    it("hides the level and the picks switch when thinking is off, and shows them again", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.click(thinkingSwitch());
      expect(useSettingsStore.getState().answerThinking).toBe(false);
      expect(thinkingSwitch().getAttribute("aria-checked")).toBe("false");
      // The two leave after their short fade
      await waitFor(() => expect(screen.queryByRole("switch", { name: "Also think for picked options" })).toBeNull());
      expect(screen.queryByRole("radiogroup", { name: "Thinking level" })).toBeNull();

      fireEvent.click(thinkingSwitch());
      expect(levelGroup()).toBeDefined();
      expect(pickSwitch()).toBeDefined();
    });

    it("turns the picks switch on and sets the level, without moving focus", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      thinkingSwitch().focus();

      fireEvent.click(pickSwitch());
      expect(useSettingsStore.getState().pickThinking).toBe(true);
      expect(pickSwitch().getAttribute("aria-checked")).toBe("true");

      fireEvent.click(within(levelGroup()).getByRole("radio", { name: "High" }));
      expect(useSettingsStore.getState().answerThinkingLevel).toBe("high");
      expect(within(levelGroup()).getByRole("radio", { name: "High" }).getAttribute("aria-checked")).toBe("true");
      expect(document.activeElement).toBe(thinkingSwitch());
    });

    it("moves the level with the arrow keys and wraps around", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.keyDown(within(levelGroup()).getByRole("radio", { name: "Medium" }), { key: "ArrowRight" });
      expect(useSettingsStore.getState().answerThinkingLevel).toBe("high");
      expect(document.activeElement).toBe(within(levelGroup()).getByRole("radio", { name: "High" }));

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
      expect(useSettingsStore.getState().answerThinkingLevel).toBe("low");

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
      expect(useSettingsStore.getState().answerThinkingLevel).toBe("high");
    });

    it("enables the switches for an OpenAI model that can turn thinking off, with no note", () => {
      useSettingsStore.setState({ selectedProvider: "openai" });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      expect((thinkingSwitch() as HTMLButtonElement).disabled).toBe(false);
      expect(thinkingSwitch().getAttribute("aria-disabled")).toBe("false");
      expect(thinkingSwitch().getAttribute("aria-checked")).toBe("true");
      expect(thinkingSwitch().getAttribute("aria-describedby")).toBe("answer-thinking-help");
      expect(screen.queryByText("This model doesn't support disabling thinking.")).toBeNull();
    });

    it("keeps thinking on and locked for a model that always thinks, and a click changes nothing", () => {
      useSettingsStore.getState().setProviderModel("openrouter", "anthropic/claude-opus-5.5");
      useSettingsStore.setState({ answerThinking: false, pickThinking: false });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      expect(thinkingSwitch().getAttribute("aria-checked")).toBe("true");
      expect(thinkingSwitch().getAttribute("aria-disabled")).toBe("true");
      expect(document.getElementById("answer-thinking-note")?.textContent).toBe(
        "This model doesn't support disabling thinking."
      );
      expect(pickSwitch().getAttribute("aria-checked")).toBe("true");
      expect(pickSwitch().getAttribute("aria-describedby")).toBe("pick-thinking-help answer-thinking-note");

      fireEvent.click(thinkingSwitch());
      fireEvent.click(pickSwitch());
      expect(useSettingsStore.getState()).toMatchObject({ answerThinking: false, pickThinking: false });
    });
  });

  describe("Keybinds tab", () => {
    it("lists every shortcut with one key chip per key and marks the while-visible ones", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keybinds" />);

      expect(screen.getByText(/only work while Sidekick is showing/)).toBeDefined();
      for (const shortcut of SHORTCUTS) {
        const row = screen.getByText(shortcut.label).closest("li") as HTMLElement;
        const chips = Array.from(row.querySelectorAll("kbd")).map((kbd) => kbd.textContent);
        expect(chips, shortcut.label).toEqual(shortcut.keys);
        expect(row.textContent?.includes("while visible"), shortcut.label).toBe(shortcut.whileVisible);
      }
    });

    it("groups the rows under a heading per group", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keybinds" />);

      for (const group of ["General", "Window", "Scroll", "Options"]) {
        expect(screen.getByRole("heading", { name: group })).toBeDefined();
      }
    });
  });

  describe("Profile tab", () => {
    it("updates the target company", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      fireEvent.change(screen.getByLabelText("Target company"), { target: { value: "Stripe" } });
      expect(useSettingsStore.getState().profile.targetCompany).toBe("Stripe");
    });

    it("selects each of the five tones, including the default balanced", () => {
      useSettingsStore.getState().setTone("staff");
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const expected: [RegExp, string][] = [
        [/^Concise/, "concise"],
        [/^Balanced/, "balanced"],
        [/^Deep/, "deep"],
        [/^Staff/, "staff"],
        [/^Architect/, "system_architect"],
      ];
      const toneGroup = screen.getByRole("radiogroup", { name: "Tone" });
      for (const [name, tone] of expected) {
        fireEvent.click(within(toneGroup).getByRole("radio", { name }));
        expect(useSettingsStore.getState().profile.tonePreset).toBe(tone);
        expect(within(toneGroup).getByRole("radio", { name }).getAttribute("aria-checked")).toBe("true");
      }
    });

    it("selects a seniority level", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      fireEvent.click(screen.getByRole("radio", { name: "Staff" }));
      expect(useSettingsStore.getState().profile.seniorityPreset).toBe("staff");
    });

    it("accepts a .txt resume through the file input", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const input = screen.getByLabelText(/drop a file/i) as HTMLInputElement;
      expect(input.accept).toBe(".txt,.md");

      const file = new File(["Senior engineer, Raft and Kubernetes."], "resume.txt", {
        type: "text/plain",
      });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(useSettingsStore.getState().profile.resumeText).toContain("Raft and Kubernetes");
      });
    });

    it("accepts a dropped .md resume", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const zone = screen.getByLabelText(/drop a file/i).closest("label") as HTMLElement;
      const file = new File(["# Experience"], "resume.md", { type: "text/markdown" });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });

      await waitFor(() => {
        expect(useSettingsStore.getState().profile.resumeText).toBe("# Experience");
      });
    });

    it("rejects a PDF with a message and leaves the resume text unchanged", async () => {
      useSettingsStore.getState().setProfile({ resumeText: "Existing resume" });
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const pdf = new File(["%PDF-1.4 binary"], "resume.pdf", { type: "application/pdf" });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/drop a file/i), { target: { files: [pdf] } });
      });

      expect(
        screen.getByText("Only .txt and .md files are supported. Paste the text instead.")
      ).toBeDefined();
      expect(useSettingsStore.getState().profile.resumeText).toBe("Existing resume");
    });

    it("rejects a file over 200 KB and leaves the resume text unchanged", async () => {
      useSettingsStore.getState().setProfile({ resumeText: "Existing resume" });
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const big = new File(["a".repeat(200 * 1024 + 1)], "big.txt", { type: "text/plain" });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/drop a file/i), { target: { files: [big] } });
      });

      expect(
        screen.getByText("That file is too large. Paste the relevant part instead.")
      ).toBeDefined();
      expect(useSettingsStore.getState().profile.resumeText).toBe("Existing resume");
    });

    it("clears the resume text", () => {
      useSettingsStore.getState().setProfile({ resumeText: "Some resume" });
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(useSettingsStore.getState().profile.resumeText).toBe("");
    });
  });

  describe("Audio tab", () => {
    it("switches the speech-to-text engine", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
      expect(useSettingsStore.getState().sttMode).toBe("whisper_local");

      fireEvent.click(screen.getByRole("radio", { name: /Groq cloud/ }));
      expect(useSettingsStore.getState().sttMode).toBe("groq");
      expect(screen.getByRole("radio", { name: /Groq cloud/ }).getAttribute("aria-checked")).toBe("true");

      expect(screen.queryByRole("radio", { name: /Deepgram/ })).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: /On this Mac/ }));
      expect(useSettingsStore.getState().sttMode).toBe("whisper_local");
    });

    it("asks for a Groq key when Groq is the engine and no key is set", () => {
      useSettingsStore.setState({ sttMode: "groq", apiKeys: { ...useSettingsStore.getState().apiKeys, groq: "" } });
      render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

      expect(screen.getByText("Add a Groq key on the General tab to use this engine.")).toBeDefined();
    });

    it("shows a failure message when the model download fails", async () => {
      vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
      render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

      expect(screen.getByText("Local speech model (tiny, about 75 MB)")).toBeDefined();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Download model" }));
      });

      expect(screen.getByText("Download failed. Check your connection.")).toBeDefined();
      expect(screen.queryByText(/ggml/)).toBeNull();
    });
  });

  describe("Appearance (General tab)", () => {
    it("shows the saved theme as selected", () => {
      useSettingsStore.setState({ theme: "dark" });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const group = screen.getByRole("radiogroup", { name: "Appearance" });
      expect(within(group).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
      expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText("System follows your macOS appearance.")).toBeDefined();
    });

    it("sets the theme when an option is chosen", () => {
      useSettingsStore.setState({ theme: "system" });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const group = screen.getByRole("radiogroup", { name: "Appearance" });
      fireEvent.click(within(group).getByRole("radio", { name: "Light" }));

      expect(useSettingsStore.getState().theme).toBe("light");
      expect(within(group).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
      expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
    });

    it("moves the theme selection with the arrow keys and wraps around", () => {
      useSettingsStore.setState({ theme: "system" });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const group = screen.getByRole("radiogroup", { name: "Appearance" });
      fireEvent.keyDown(within(group).getByRole("radio", { name: "System" }), { key: "ArrowRight" });
      expect(useSettingsStore.getState().theme).toBe("light");
      expect(document.activeElement).toBe(within(group).getByRole("radio", { name: "Light" }));

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
      expect(useSettingsStore.getState().theme).toBe("dark");

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
      expect(useSettingsStore.getState().theme).toBe("system");

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
      expect(useSettingsStore.getState().theme).toBe("dark");
      expect(within(group).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    });

    it("slides the selection thumb to the chosen theme's column", () => {
      useSettingsStore.setState({ theme: "dark" });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const group = screen.getByRole("radiogroup", { name: "Appearance" });
      const thumb = group.querySelector<HTMLElement>(":scope > span[aria-hidden='true']");
      expect(thumb?.style.transform).toContain("translateX(calc(2 * ");
    });
  });

  describe("Advanced (General tab)", () => {
    it("starts folded and shows Burn and Reset when opened", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      const toggle = screen.getByRole("button", { name: "Advanced" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: "Burn" })).toBeNull();

      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("These can't be undone.")).toBeDefined();
      expect(screen.getByRole("button", { name: "Reset" })).toBeDefined();
    });

    it("burns the session only on the second click and clears it after the confirm times out", async () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockResolvedValue(undefined);
      useSessionStore.getState().addTranscriptTurn({
        speaker: "interviewer",
        text: "Tell me about Paxos vs Raft.",
        timestamp: Date.now(),
      });
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      fireEvent.click(screen.getByRole("button", { name: "Burn" }));
      expect(screen.getByRole("button", { name: "Click again to burn" })).toBeDefined();
      expect(useSessionStore.getState().transcript.length).toBe(1);
      expect(spyInvoke).not.toHaveBeenCalledWith("burn_session");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Click again to burn" }));
      });

      expect(useSessionStore.getState().transcript.length).toBe(0);
      expect(spyInvoke).toHaveBeenCalledWith("burn_session");
      expect(screen.getByText("Session cleared")).toBeDefined();
    });

    it("shows a failure instead of Session cleared when the backend burn fails", async () => {
      vi.spyOn(ipc, "invokeInTauri").mockRejectedValue(new Error("locked"));
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      fireEvent.click(screen.getByRole("button", { name: "Burn" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Click again to burn" }));
      });

      expect(screen.getByText("Couldn't clear the session in the backend. Try again.")).toBeDefined();
      expect(screen.queryByText("Session cleared")).toBeNull();
    });

    it("drops the burn confirm after 3 seconds", () => {
      vi.useFakeTimers();
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      fireEvent.click(screen.getByRole("button", { name: "Burn" }));
      expect(screen.getByRole("button", { name: "Click again to burn" })).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByRole("button", { name: "Burn" })).toBeDefined();
    });

    it("resets settings only on the second click", async () => {
      vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
      useSettingsStore.getState().setSeniority("principal");
      useSettingsStore.getState().setProviderModel("openrouter", "anthropic/claude-opus-5.5");
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(useSettingsStore.getState().selectedModels.openrouter).toBe("anthropic/claude-opus-5.5");

      fireEvent.click(screen.getByRole("button", { name: "Click again to reset" }));

      const state = useSettingsStore.getState();
      expect(state.profile.seniorityPreset).toBe("senior");
      expect(state.selectedModels.openrouter).toBe("anthropic/claude-haiku-5.5");
      expect(screen.getByText("Settings reset")).toBeDefined();
    });

    it("drops the reset confirm after 3 seconds", () => {
      vi.useFakeTimers();
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByRole("button", { name: "Reset" })).toBeDefined();
    });
  });
});

describe("SettingsDrawer microphone and language", () => {
  const devices = [
    { name: "MacBook Pro Microphone", isDefault: true },
    { name: "USB Mic", isDefault: false },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetSettings();
    useAppStore.setState({ isVisible: true, meetingStatus: "idle" });
    vi.spyOn(ipc, "listInputDevices").mockResolvedValue(devices);
    vi.spyOn(ipc, "startMicTest").mockResolvedValue(undefined);
    vi.spyOn(ipc, "stopMicTest").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the input devices, with System default naming the current default", async () => {
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

    const select = (await screen.findByLabelText("Input device")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "System default (MacBook Pro Microphone)",
      "MacBook Pro Microphone",
      "USB Mic",
    ]);
    expect(ipc.listInputDevices).toHaveBeenCalled();
  });

  it("pushes the chosen microphone to Rust, and null for the system default", async () => {
    const safe = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
    const select = (await screen.findByLabelText("Input device")) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "USB Mic" } });
    expect(useSettingsStore.getState().micDeviceName).toBe("USB Mic");
    expect(safe).toHaveBeenCalledWith("set_mic_device", { name: "USB Mic" });

    fireEvent.change(select, { target: { value: "" } });
    expect(useSettingsStore.getState().micDeviceName).toBeNull();
    expect(safe).toHaveBeenLastCalledWith("set_mic_device", { name: null });
  });

  it("pushes the transcription language to Rust and shows the warning it returns under the select", async () => {
    vi.spyOn(ipc, "safeInvoke").mockImplementation(async (cmd: string) =>
      cmd === "set_stt_language" ? "The on-device model only transcribes English." : null
    );
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

    fireEvent.change(screen.getByLabelText("Transcription language"), { target: { value: "hi" } });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("The on-device model only transcribes English.")
    );
    expect(ipc.safeInvoke).toHaveBeenCalledWith("set_stt_language", { language: "hi" });
  });

  it("offers Auto-detect for transcription but not for the output language, which defaults to English", () => {
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

    const transcription = Array.from((screen.getByLabelText("Transcription language") as HTMLSelectElement).options);
    const output = Array.from((screen.getByLabelText("Output language") as HTMLSelectElement).options);
    expect(transcription[0].textContent).toBe("Auto-detect");
    expect(transcription.map((o) => o.value)).toEqual(["auto", "en", "hi", "es", "fr", "de", "pt", "ja", "zh", "ko", "ar"]);
    expect(output.map((o) => o.textContent)).not.toContain("Auto-detect");
    expect((screen.getByLabelText("Output language") as HTMLSelectElement).value).toBe("English");

    fireEvent.change(screen.getByLabelText("Output language"), { target: { value: "Hindi" } });
    expect(useSettingsStore.getState().outputLanguage).toBe("Hindi");
  });

  it("runs the microphone test from the Test button and stops it on the second press", async () => {
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());
    expect(ipc.startMicTest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop test" }));
    expect(ipc.stopMicTest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Test" })).toBeDefined();
  });

  it("shows Rust's rejection message inline and stays idle", async () => {
    vi.spyOn(ipc, "startMicTest").mockRejectedValue("Stop listening before testing the microphone.");
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe("Stop listening before testing the microphone.");
    expect(screen.getByRole("button", { name: "Test" })).toBeDefined();
  });

  it("ends a running test when the tab changes or the drawer closes", async () => {
    const { rerender } = render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());

    openTab("Profile");
    expect(ipc.stopMicTest).toHaveBeenCalledTimes(1);

    openTab("Audio");
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());

    rerender(<SettingsDrawer isOpen={false} />);
    expect(ipc.stopMicTest).toHaveBeenCalledTimes(2);
  });

  it("gives every tab an icon above its label, in an even five-column strip", () => {
    render(<SettingsDrawer isOpen={true} />);

    const strip = screen.getByRole("tablist");
    expect(strip.className).toContain("grid-cols-5");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.querySelector("svg")).not.toBeNull();
      expect(tab.querySelector("span")?.textContent).toBe(tab.textContent);
    }
  });

  it("disables Test outside idle, and stops a running test when a meeting starts", async () => {
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());

    act(() => useAppStore.setState({ meetingStatus: "starting" }));

    await waitFor(() => expect(ipc.stopMicTest).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Stop listening before testing the microphone.")).toBeDefined();

    act(() => useAppStore.setState({ meetingStatus: "idle" }));
    expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stops a running test when Sidekick hides, and the drawer stays mounted", async () => {
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());

    act(() => useAppStore.setState({ isVisible: false }));

    await waitFor(() => expect(ipc.stopMicTest).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByRole("button", { name: "Test" })).toBeDefined();
  });

  it("restarts a running test on the new device: stop, then set the device, then start", async () => {
    const safe = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
    render(<SettingsDrawer isOpen={true} defaultTab="audio" />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined());

    fireEvent.change(await screen.findByLabelText("Input device"), { target: { value: "USB Mic" } });

    await waitFor(() => expect(ipc.startMicTest).toHaveBeenCalledTimes(2));
    const stopped = vi.mocked(ipc.stopMicTest).mock.invocationCallOrder[0];
    const setIndex = safe.mock.calls.findIndex(([cmd]) => cmd === "set_mic_device");
    const deviceSet = safe.mock.invocationCallOrder[setIndex];
    const started = vi.mocked(ipc.startMicTest).mock.invocationCallOrder[1];
    expect(safe.mock.calls[setIndex]).toEqual(["set_mic_device", { name: "USB Mic" }]);
    expect(stopped).toBeLessThan(deviceSet);
    expect(deviceSet).toBeLessThan(started);
    expect(screen.getByRole("button", { name: "Stop test" })).toBeDefined();
  });
});
