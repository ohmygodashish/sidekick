import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../store/settingsStore";

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("should have expected default settings", () => {
    const state = useSettingsStore.getState();
    expect(state.selectedProvider).toBe("openrouter");
    expect(state.selectedModel).toBe("anthropic/claude-3.5-sonnet");
    expect(state.evaluatorModel).toBe("groq/llama-3.3-70b-versatile");
    expect(state.sttMode).toBe("whisper_local");
    expect(state.profile.seniorityPreset).toBe("senior");
    expect(state.profile.tonePreset).toBe("balanced");
  });

  it("should update API keys correctly", () => {
    useSettingsStore.getState().setApiKey("openrouter", "sk-or-v1-testkey123");
    useSettingsStore.getState().setApiKey("anthropic", "sk-ant-testkey456");

    const { apiKeys } = useSettingsStore.getState();
    expect(apiKeys.openrouter).toBe("sk-or-v1-testkey123");
    expect(apiKeys.anthropic).toBe("sk-ant-testkey456");
    expect(apiKeys.openai).toBe("");
  });

  it("should update model and provider", () => {
    useSettingsStore.getState().setSelectedProvider("anthropic");
    useSettingsStore.getState().setSelectedModel("claude-3-5-sonnet-20241022");

    const state = useSettingsStore.getState();
    expect(state.selectedProvider).toBe("anthropic");
    expect(state.selectedModel).toBe("claude-3-5-sonnet-20241022");
  });

  it("should update personalization profile and presets", () => {
    useSettingsStore.getState().setProfile({
      resumeText: "Staff Distributed Systems Engineer with 10 years experience",
      targetCompany: "Google",
      jobDescription: "Staff Software Engineer, Core Cloud Infrastructure",
    });

    useSettingsStore.getState().setSeniority("staff");
    useSettingsStore.getState().setTone("concise");

    const { profile } = useSettingsStore.getState();
    expect(profile.resumeText).toContain("Staff Distributed Systems");
    expect(profile.targetCompany).toBe("Google");
    expect(profile.seniorityPreset).toBe("staff");
    expect(profile.tonePreset).toBe("concise");
  });

  it("should update STT mode", () => {
    useSettingsStore.getState().setSttMode("deepgram");
    expect(useSettingsStore.getState().sttMode).toBe("deepgram");

    useSettingsStore.getState().setSttMode("groq");
    expect(useSettingsStore.getState().sttMode).toBe("groq");

    useSettingsStore.getState().setSttMode("whisper_local");
    expect(useSettingsStore.getState().sttMode).toBe("whisper_local");
  });

  it("should reset settings to default values", () => {
    useSettingsStore.getState().setApiKey("groq", "test_groq_key");
    useSettingsStore.getState().setSeniority("principal");

    useSettingsStore.getState().resetSettings();

    const state = useSettingsStore.getState();
    expect(state.apiKeys.groq).toBe("");
    expect(state.profile.seniorityPreset).toBe("senior");
  });
});
