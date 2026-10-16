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

    it("renders an inline dialog with seven tabs, API keys selected by default", () => {
      render(<SettingsDrawer isOpen={true} />);

      expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual([
        "API keys",
        "Profile",
        "Modes",
        "Audio",
        "Appearance",
        "Keybinds",
        "Danger",
      ]);
      expect(screen.getByRole("tab", { name: "API keys" }).getAttribute("aria-selected")).toBe("true");
    });

    it("switches tabs and marks the selected one", () => {
      render(<SettingsDrawer isOpen={true} />);

      openTab("Profile");
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "API keys" }).getAttribute("aria-selected")).toBe("false");
      expect(screen.getByText("Changes save automatically.")).toBeDefined();

      openTab("Audio");
      expect(screen.getByRole("radiogroup", { name: "Speech-to-text engine" })).toBeDefined();

      openTab("Appearance");
      expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeDefined();

      openTab("Danger");
      expect(screen.getByText("These can't be undone.")).toBeDefined();
    });

    it("moves focus to the selected tab when it opens", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Profile" }));
    });

    it("moves between tabs with the arrow keys", () => {
      render(<SettingsDrawer isOpen={true} />);
      const keysTab = screen.getByRole("tab", { name: "API keys" });

      fireEvent.keyDown(keysTab, { key: "ArrowRight" });
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(screen.getByRole("tab", { name: "Profile" }), { key: "ArrowLeft" });
      fireEvent.keyDown(screen.getByRole("tab", { name: "API keys" }), { key: "ArrowLeft" });
      expect(screen.getByRole("tab", { name: "Danger" }).getAttribute("aria-selected")).toBe("true");
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

      for (const name of ["API keys", "Profile", "Modes", "Audio", "Appearance", "Keybinds", "Danger"]) {
        openTab(name);
        expect(screen.getByRole("dialog").textContent).not.toMatch(
          /REQ-|SEC-|ggml|Metal|ScreenCaptureKit|hardware-backed/i
        );
      }
    });

    it("uses theme tokens, not palette colours, on every tab", () => {
      render(<SettingsDrawer isOpen={true} />);
      const palette =
        /(?:^|[\s:])(?:text|bg|ring|border|placeholder|divide|fill)-(?:zinc|sky|red|emerald|amber|orange|slate|gray|white|black)\b/;

      for (const name of ["API keys", "Profile", "Modes", "Audio", "Appearance", "Keybinds", "Danger"]) {
        openTab(name);
        const offenders = Array.from(screen.getByRole("dialog").querySelectorAll("[class]"))
          .map((el) => el.getAttribute("class") ?? "")
          .filter((cls) => palette.test(cls));
        expect(offenders, `${name} tab`).toEqual([]);
      }
    });
  });

  describe("API keys tab", () => {
    it("saves keys to the backend and shows Saved", async () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockResolvedValue(undefined);
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.change(screen.getByLabelText("OpenAI API key"), {
        target: { value: "sk-proj-valid-openai-key" },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save keys" }));
      });

      expect(spyInvoke).toHaveBeenCalledWith("store_api_key", {
        provider: "openai",
        key: "sk-proj-valid-openai-key",
      });
      // Cleared keys are propagated too, so deleted keys are wiped in the backend
      expect(spyInvoke).toHaveBeenCalledWith("store_api_key", { provider: "anthropic", key: "" });
      expect(screen.getByText("Saved")).toBeDefined();
    });

    it("shows a failure instead of Saved when the backend rejects the save", async () => {
      vi.spyOn(ipc, "invokeInTauri").mockRejectedValue(new Error("disk full"));
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save keys" }));
      });

      expect(screen.getByText("Couldn't save keys. Try again.")).toBeDefined();
      expect(screen.queryByText("Saved")).toBeNull();
    });

    it("checks the key format only and never calls the backend", () => {
      const spyInvoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.change(screen.getByLabelText("Anthropic API key"), {
        target: { value: "sk-ant-api03-test" },
      });
      fireEvent.click(within(providerRow("Anthropic")).getByRole("button", { name: "Check format" }));
      expect(within(providerRow("Anthropic")).getByText("Format looks right")).toBeDefined();

      fireEvent.change(screen.getByLabelText("Anthropic API key"), {
        target: { value: "bad-prefix-key" },
      });
      fireEvent.click(within(providerRow("Anthropic")).getByRole("button", { name: "Check format" }));
      expect(
        within(providerRow("Anthropic")).getByText("Invalid key format: Must start with sk-ant-")
      ).toBeDefined();

      expect(spyInvoke).not.toHaveBeenCalled();
    });

    it("reports an empty key as required", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);
      fireEvent.click(within(providerRow("Groq")).getByRole("button", { name: "Check format" }));
      expect(within(providerRow("Groq")).getByText("API key is required")).toBeDefined();
    });

    it("toggles a key between hidden and visible", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const input = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
      expect(input.type).toBe("password");

      fireEvent.click(within(providerRow("OpenAI")).getByRole("button", { name: "Show key" }));
      expect(input.type).toBe("text");

      fireEvent.click(within(providerRow("OpenAI")).getByRole("button", { name: "Hide key" }));
      expect(input.type).toBe("password");
    });

    it("stores typed keys in the store and selects provider and models", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.change(screen.getByLabelText("Anthropic API key"), {
        target: { value: "sk-ant-api03-test-token-12345" },
      });
      expect(useSettingsStore.getState().apiKeys.anthropic).toBe("sk-ant-api03-test-token-12345");

      fireEvent.change(screen.getByLabelText("Primary provider"), { target: { value: "anthropic" } });
      expect(useSettingsStore.getState().selectedProvider).toBe("anthropic");

      fireEvent.change(screen.getByLabelText("Solution model"), {
        target: { value: "anthropic/claude-x" },
      });
      expect(useSettingsStore.getState().selectedModel).toBe("anthropic/claude-x");

      fireEvent.change(screen.getByLabelText("Evaluator model (fast)"), {
        target: { value: "groq/some-model" },
      });
      expect(useSettingsStore.getState().evaluatorModel).toBe("groq/some-model");
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

      fireEvent.click(screen.getByRole("radio", { name: /Deepgram streaming/ }));
      expect(useSettingsStore.getState().sttMode).toBe("deepgram");

      fireEvent.click(screen.getByRole("radio", { name: /On this Mac/ }));
      expect(useSettingsStore.getState().sttMode).toBe("whisper_local");
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

  describe("Appearance tab", () => {
    it("shows the saved theme as selected", () => {
      useSettingsStore.setState({ theme: "dark" });
      render(<SettingsDrawer isOpen={true} defaultTab="appearance" />);

      const group = screen.getByRole("radiogroup", { name: "Theme" });
      expect(within(group).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
      expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText("System follows your macOS appearance.")).toBeDefined();
    });

    it("sets the theme when an option is chosen", () => {
      useSettingsStore.setState({ theme: "system" });
      render(<SettingsDrawer isOpen={true} defaultTab="appearance" />);

      const group = screen.getByRole("radiogroup", { name: "Theme" });
      fireEvent.click(within(group).getByRole("radio", { name: "Light" }));

      expect(useSettingsStore.getState().theme).toBe("light");
      expect(within(group).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
      expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
    });

    it("moves the theme selection with the arrow keys and wraps around", () => {
      useSettingsStore.setState({ theme: "system" });
      render(<SettingsDrawer isOpen={true} defaultTab="appearance" />);

      const group = screen.getByRole("radiogroup", { name: "Theme" });
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
  });

  describe("Danger tab", () => {
    it("burns the session only on the second click and clears it after the confirm times out", async () => {
      const spyInvoke = vi.spyOn(ipc, "invokeInTauri").mockResolvedValue(undefined);
      useSessionStore.getState().addTranscriptTurn({
        speaker: "interviewer",
        text: "Tell me about Paxos vs Raft.",
        timestamp: Date.now(),
      });
      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

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
      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

      fireEvent.click(screen.getByRole("button", { name: "Burn" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Click again to burn" }));
      });

      expect(screen.getByText("Couldn't clear the session in the backend. Try again.")).toBeDefined();
      expect(screen.queryByText("Session cleared")).toBeNull();
    });

    it("drops the burn confirm after 3 seconds", () => {
      vi.useFakeTimers();
      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

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
      useSettingsStore.getState().setSelectedModel("custom-model");
      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(useSettingsStore.getState().selectedModel).toBe("custom-model");

      fireEvent.click(screen.getByRole("button", { name: "Click again to reset" }));

      const state = useSettingsStore.getState();
      expect(state.profile.seniorityPreset).toBe("senior");
      expect(state.selectedModel).toBe("anthropic/claude-haiku-5.5");
      expect(screen.getByText("Settings reset")).toBeDefined();
    });

    it("drops the reset confirm after 3 seconds", () => {
      vi.useFakeTimers();
      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

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

  it("gives every tab an icon above its label, in an even seven-column strip", () => {
    render(<SettingsDrawer isOpen={true} />);

    const strip = screen.getByRole("tablist");
    expect(strip.className).toContain("grid-cols-7");
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
