import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { SettingsDrawer } from "../components/settings/SettingsDrawer";
import { HUDContainer } from "../components/hud/HUDContainer";
import { NotchCompanion } from "../components/hud/NotchCompanion";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { useAppStore } from "../store/appStore";
import * as ipc from "../lib/ipc";

describe("SettingsDrawer & Personalization Manager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetSettings();
    useSessionStore.getState().clearSession();
    useAppStore.setState({
      layoutMode: "floating_hud",
      opacity: 0.85,
      isClickThrough: false,
      isVisible: true,
      isPanicked: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Access Control & Drawer Visibility (REQ-002)", () => {
    it("does not render when isSettingsOpen is false", () => {
      useSettingsStore.setState({ isSettingsOpen: false });
      render(<SettingsDrawer />);

      expect(screen.queryByTestId("settings-drawer")).toBeNull();
      expect(screen.queryByTestId("settings-backdrop")).toBeNull();
    });

    it("renders modal and sheet when isSettingsOpen is true", () => {
      useSettingsStore.setState({ isSettingsOpen: true });
      render(<SettingsDrawer />);

      expect(screen.getByTestId("settings-drawer")).toBeDefined();
      expect(screen.getByTestId("settings-backdrop")).toBeDefined();
      expect(screen.getByText("Settings & Personalization")).toBeDefined();
    });

    it("closes drawer when clicking close button", () => {
      useSettingsStore.setState({ isSettingsOpen: true });
      render(<SettingsDrawer />);

      const closeBtn = screen.getByTestId("close-settings-btn");
      fireEvent.click(closeBtn);

      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });

    it("closes drawer when clicking backdrop overlay", () => {
      useSettingsStore.setState({ isSettingsOpen: true });
      render(<SettingsDrawer />);

      const backdrop = screen.getByTestId("settings-backdrop");
      fireEvent.click(backdrop);

      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });

    it("closes drawer when pressing Escape key", () => {
      useSettingsStore.setState({ isSettingsOpen: true });
      render(<SettingsDrawer />);

      fireEvent.keyDown(window, { key: "Escape" });

      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });

    it("toggles drawer when pressing Cmd + , hotkey", () => {
      useSettingsStore.setState({ isSettingsOpen: false });
      render(<SettingsDrawer isOpen={false} />);

      // Press Cmd + ,
      fireEvent.keyDown(window, { key: ",", metaKey: true });
      expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

      // Press Cmd + , again
      fireEvent.keyDown(window, { key: ",", metaKey: true });
      expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    });

    it("opens settings when clicking settings button in HUDContainer", () => {
      useSettingsStore.setState({ isSettingsOpen: false });
      render(<HUDContainer />);

      const settingsBtn = screen.getByTestId("hud-settings-btn");
      fireEvent.click(settingsBtn);

      expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    });

    it("opens settings when clicking settings button in NotchCompanion", () => {
      useSettingsStore.setState({ isSettingsOpen: false });
      render(<NotchCompanion />);

      const notchSettingsBtn = screen.getByTestId("notch-settings-btn");
      fireEvent.click(notchSettingsBtn);

      expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    });
  });

  describe("Tab Navigation", () => {
    it("switches cleanly across all 4 tabbed sections", () => {
      render(<SettingsDrawer isOpen={true} />);

      // Default tab: keys
      expect(screen.getByTestId("api-key-inputs")).toBeDefined();

      // Click profile tab
      fireEvent.click(screen.getByTestId("tab-profile"));
      expect(screen.getByTestId("profile-editor")).toBeDefined();

      // Click audio tab
      fireEvent.click(screen.getByTestId("tab-audio"));
      expect(screen.getByTestId("audio-settings")).toBeDefined();

      // Click danger zone tab
      fireEvent.click(screen.getByTestId("tab-danger"));
      expect(screen.getByTestId("danger-zone")).toBeDefined();

      // Back to keys tab
      fireEvent.click(screen.getByTestId("tab-keys"));
      expect(screen.getByTestId("api-key-inputs")).toBeDefined();
    });
  });

  describe("Multi-Provider API Keys & Models (REQ-016, SEC-001)", () => {
    it("renders all 6 supported LLM and STT providers with masked inputs", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const providers = ["openrouter", "anthropic", "openai", "gemini", "groq", "deepgram"];
      providers.forEach((p) => {
        const input = screen.getByTestId(`input-${p}`) as HTMLInputElement;
        expect(input).toBeDefined();
        expect(input.type).toBe("password");
        expect(screen.getByTestId(`toggle-visibility-${p}`)).toBeDefined();
        expect(screen.getByTestId(`test-btn-${p}`)).toBeDefined();
      });
    });

    it("toggles input visibility between masked password and plaintext", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const input = screen.getByTestId("input-openai") as HTMLInputElement;
      const toggleBtn = screen.getByTestId("toggle-visibility-openai");

      expect(input.type).toBe("password");

      // Click peek
      fireEvent.click(toggleBtn);
      expect(input.type).toBe("text");

      // Click hide
      fireEvent.click(toggleBtn);
      expect(input.type).toBe("password");
    });

    it("updates API keys in in-memory store upon typing", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const input = screen.getByTestId("input-anthropic") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "sk-ant-api03-test-token-12345" } });

      expect(useSettingsStore.getState().apiKeys.anthropic).toBe(
        "sk-ant-api03-test-token-12345"
      );
    });

    it("performs format validation and reports error on invalid/empty keys", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      // Test with empty key
      const testBtn = screen.getByTestId("test-btn-openrouter");
      fireEvent.click(testBtn);

      await waitFor(() => {
        const status = screen.getByTestId("status-openrouter");
        expect(status.textContent).toContain("API key is required");
      });

      // Test with invalid prefix
      const input = screen.getByTestId("input-openrouter");
      fireEvent.change(input, { target: { value: "bad-prefix-key" } });
      fireEvent.click(testBtn);

      await waitFor(() => {
        const status = screen.getByTestId("status-openrouter");
        expect(status.textContent).toContain("Must start with sk-or-");
      });
    });

    it("performs format validation and reports success on valid format keys", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const input = screen.getByTestId("input-groq");
      fireEvent.change(input, { target: { value: "gsk_valid_test_key_sample_789" } });

      const testBtn = screen.getByTestId("test-btn-groq");
      fireEvent.click(testBtn);

      await waitFor(() => {
        const status = screen.getByTestId("status-groq");
        expect(status.textContent).toContain("Groq key format verified");
      });
    });

    it("persists keys to backend via store_api_key when clicking Save API Keys", async () => {
      const spyInvoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);

      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      fireEvent.change(screen.getByTestId("input-openai"), {
        target: { value: "sk-proj-valid-openai-key" },
      });

      const saveBtn = screen.getByTestId("save-keys-btn");
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      expect(spyInvoke).toHaveBeenCalledWith("store_api_key", {
        provider: "openai",
        key: "sk-proj-valid-openai-key",
      });

      expect(screen.getByText("Saved!")).toBeDefined();
    });

    it("allows selecting provider and customizing models", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="keys" />);

      const providerSelect = screen.getByTestId("selected-provider-select") as HTMLSelectElement;
      fireEvent.change(providerSelect, { target: { value: "anthropic" } });
      expect(useSettingsStore.getState().selectedProvider).toBe("anthropic");

      const modelInput = screen.getByTestId("selected-model-input") as HTMLInputElement;
      fireEvent.change(modelInput, { target: { value: "anthropic/claude-3.5-opus" } });
      expect(useSettingsStore.getState().selectedModel).toBe("anthropic/claude-3.5-opus");

      const evaluatorInput = screen.getByTestId("evaluator-model-input") as HTMLInputElement;
      fireEvent.change(evaluatorInput, { target: { value: "groq/llama-3.1-8b-instant" } });
      expect(useSettingsStore.getState().evaluatorModel).toBe("groq/llama-3.1-8b-instant");
    });
  });

  describe("Profile & Personalization Context", () => {
    it("updates target company and job description fields", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const companyInput = screen.getByTestId("target-company-input");
      fireEvent.change(companyInput, { target: { value: "Stripe" } });
      expect(useSettingsStore.getState().profile.targetCompany).toBe("Stripe");

      const jdInput = screen.getByTestId("job-description-input");
      fireEvent.change(jdInput, {
        target: { value: "Staff Infrastructure Engineer - Global Payments Engine" },
      });
      expect(useSettingsStore.getState().profile.jobDescription).toContain(
        "Global Payments Engine"
      );
    });

    it("updates resume text directly via textarea and handles clear", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const textarea = screen.getByTestId("resume-textarea");
      fireEvent.change(textarea, {
        target: { value: "10+ years designing distributed storage and consensus protocols." },
      });

      expect(useSettingsStore.getState().profile.resumeText).toContain(
        "distributed storage"
      );

      // Clear button should be visible when text is present
      const clearBtn = screen.getByTestId("clear-resume-btn");
      fireEvent.click(clearBtn);

      expect(useSettingsStore.getState().profile.resumeText).toBe("");
    });

    it("handles resume file drop and extracts content", async () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const dropzone = screen.getByTestId("resume-dropzone");

      const mockFile = new File(
        ["Senior Staff Engineer with deep expertise in Raft and Kubernetes."],
        "resume.txt",
        { type: "text/plain" }
      );

      await act(async () => {
        fireEvent.drop(dropzone, {
          dataTransfer: {
            files: [mockFile],
          },
        });
      });

      await waitFor(() => {
        expect(useSettingsStore.getState().profile.resumeText).toContain(
          "Senior Staff Engineer with deep expertise"
        );
      });
    });

    it("selects Staff Engineer, Concise 3 Bullets, and System Architect tone presets", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      // 1. Staff Engineer
      const staffCard = screen.getByTestId("tone-staff");
      fireEvent.click(staffCard);
      expect(useSettingsStore.getState().profile.tonePreset).toBe("staff");

      // 2. Concise 3 Bullets
      const conciseCard = screen.getByTestId("tone-concise");
      fireEvent.click(conciseCard);
      expect(useSettingsStore.getState().profile.tonePreset).toBe("concise");

      // 3. System Architect
      const architectCard = screen.getByTestId("tone-architect");
      fireEvent.click(architectCard);
      expect(useSettingsStore.getState().profile.tonePreset).toBe("system_architect");
    });

    it("updates seniority presets (junior, mid, senior, staff, principal)", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      fireEvent.click(screen.getByTestId("seniority-staff"));
      expect(useSettingsStore.getState().profile.seniorityPreset).toBe("staff");

      fireEvent.click(screen.getByTestId("seniority-principal"));
      expect(useSettingsStore.getState().profile.seniorityPreset).toBe("principal");
    });

    it("provides save confirmation feedback", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="profile" />);

      const saveBtn = screen.getByTestId("save-profile-btn");
      fireEvent.click(saveBtn);

      expect(screen.getByText("Profile Saved!")).toBeDefined();
    });
  });

  describe("Audio & Transcription Engine Settings", () => {
    it("switches STT engine between Embedded Whisper, Groq, and Deepgram", () => {
      render(<SettingsDrawer isOpen={true} defaultTab="audio" />);

      // Initially default: whisper_local
      expect(useSettingsStore.getState().sttMode).toBe("whisper_local");

      // Switch to Groq
      fireEvent.click(screen.getByTestId("stt-groq"));
      expect(useSettingsStore.getState().sttMode).toBe("groq");

      // Switch to Deepgram
      fireEvent.click(screen.getByTestId("stt-deepgram"));
      expect(useSettingsStore.getState().sttMode).toBe("deepgram");

      // Switch back to Embedded Whisper
      fireEvent.click(screen.getByTestId("stt-whisper-local"));
      expect(useSettingsStore.getState().sttMode).toBe("whisper_local");
    });
  });

  describe("Danger Zone & Burn Session (REQ-017)", () => {
    it("eradicates session store, calls burn_session IPC command, and displays feedback", async () => {
      const spyInvoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);

      // Seed session store with active interview state
      useSessionStore.getState().addTranscriptTurn({
        speaker: "interviewer",
        text: "Tell me about Paxos vs Raft.",
        timestamp: Date.now(),
      });
      useSessionStore.getState().setActiveQuestion({
        questionId: "q_destroy_test",
        timestamp: Date.now(),
        confidence: 0.99,
        extractedQuestion: "Paxos vs Raft consensus tradeoffs",
        quickPointers: ["Leader election", "Simplicity"],
        rawTranscript: "Tell me about Paxos",
      });
      useSessionStore.getState().setSolution({
        stage1Intuition: {
          verbalSummary: "Raft is strictly decomposed for comprehensibility.",
          keyTradeoffs: ["Understandability vs Paxos general topology"],
        },
        stage2Code: null,
        stage3Analysis: null,
      });

      expect(useSessionStore.getState().transcript.length).toBe(1);
      expect(useSessionStore.getState().activeQuestion).not.toBeNull();
      expect(useSessionStore.getState().stage1Intuition).not.toBeNull();

      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

      const burnBtn = screen.getByTestId("burn-session-btn");

      await act(async () => {
        fireEvent.click(burnBtn);
      });

      // 1. Session store must be completely wiped
      expect(useSessionStore.getState().transcript.length).toBe(0);
      expect(useSessionStore.getState().activeQuestion).toBeNull();
      expect(useSessionStore.getState().stage1Intuition).toBeNull();
      expect(useSessionStore.getState().stage2Code).toBeNull();
      expect(useSessionStore.getState().stage3Analysis).toBeNull();

      // 2. safeInvoke('burn_session') must have been dispatched
      expect(spyInvoke).toHaveBeenCalledWith("burn_session");

      // 3. Visual feedback banner displayed
      const feedback = screen.getByTestId("burn-session-feedback");
      expect(feedback.textContent).toContain("Session Burned");
    });

    it("resets all settings to default values", () => {
      useSettingsStore.getState().setSeniority("principal");
      useSettingsStore.getState().setSttMode("deepgram");
      useSettingsStore.getState().setSelectedModel("gpt-4o-custom");

      render(<SettingsDrawer isOpen={true} defaultTab="danger" />);

      const resetBtn = screen.getByTestId("reset-settings-btn");
      fireEvent.click(resetBtn);

      const state = useSettingsStore.getState();
      expect(state.profile.seniorityPreset).toBe("senior");
      expect(state.sttMode).toBe("whisper_local");
      expect(state.selectedModel).toBe("anthropic/claude-3.5-sonnet");

      expect(screen.getByTestId("reset-feedback")).toBeDefined();
    });
  });
});
