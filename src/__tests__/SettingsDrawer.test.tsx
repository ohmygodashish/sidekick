import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { SettingsDrawer } from "../components/settings/SettingsDrawer";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import * as ipc from "../lib/ipc";

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

    it("renders an inline dialog with four tabs, Keys selected by default", () => {
      render(<SettingsDrawer isOpen={true} />);

      expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["Keys", "Profile", "Audio", "Danger"]);
      expect(screen.getByRole("tab", { name: "Keys" }).getAttribute("aria-selected")).toBe("true");
    });

    it("switches tabs and marks the selected one", () => {
      render(<SettingsDrawer isOpen={true} />);

      openTab("Profile");
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "Keys" }).getAttribute("aria-selected")).toBe("false");
      expect(screen.getByText("Changes save automatically.")).toBeDefined();

      openTab("Audio");
      expect(screen.getByRole("radiogroup", { name: "Speech-to-text engine" })).toBeDefined();

      openTab("Danger");
      expect(screen.getByText("These can't be undone.")).toBeDefined();
    });

    it("moves focus to the selected tab when it opens", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Profile" }));
    });

    it("moves between tabs with the arrow keys", () => {
      render(<SettingsDrawer isOpen={true} />);
      const keysTab = screen.getByRole("tab", { name: "Keys" });

      fireEvent.keyDown(keysTab, { key: "ArrowRight" });
      expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(screen.getByRole("tab", { name: "Profile" }), { key: "ArrowLeft" });
      fireEvent.keyDown(screen.getByRole("tab", { name: "Keys" }), { key: "ArrowLeft" });
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

      for (const name of ["Keys", "Profile", "Audio", "Danger"]) {
        openTab(name);
        expect(screen.getByRole("dialog").textContent).not.toMatch(
          /REQ-|SEC-|ggml|Metal|ScreenCaptureKit|hardware-backed/i
        );
      }
    });
  });

  describe("Keys tab", () => {
    it("saves keys to the backend and shows Saved", async () => {
      const spyInvoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
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

  describe("Danger tab", () => {
    it("burns the session only on the second click and clears it after the confirm times out", async () => {
      const spyInvoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
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
      expect(state.selectedModel).toBe("anthropic/claude-3.5-sonnet");
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
