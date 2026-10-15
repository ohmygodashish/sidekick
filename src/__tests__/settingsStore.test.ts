import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSettingsStore } from "../store/settingsStore";

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
    const { apiKeys } = useSettingsStore.getState();
    useSettingsStore.setState({
      apiKeys: Object.fromEntries(Object.keys(apiKeys).map((k) => [k, ""])) as typeof apiKeys,
    });
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
    // Keys survive a reset so a later "Save keys" can't wipe them from the config file
    expect(state.apiKeys.groq).toBe("test_groq_key");
    expect(state.profile.seniorityPreset).toBe("senior");
  });

  it("should exclude apiKeys from localStorage per SEC-001 partialize rule", () => {
    useSettingsStore.getState().setApiKey("openai", "sk-secret-test-key-should-not-persist");
    useSettingsStore.getState().setSelectedModel("gpt-4o");

    const raw = localStorage.getItem("sidekick-settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // State in localStorage must not have apiKeys
    expect(parsed.state.apiKeys).toBeUndefined();
    expect(parsed.state.selectedModel).toBe("gpt-4o");
    // In-memory state still retains the key
    expect(useSettingsStore.getState().apiKeys.openai).toBe("sk-secret-test-key-should-not-persist");
  });
});

// Kept last: it re-imports the store module with Tauri mocked in.
describe("settings storage inside Tauri (config file)", () => {
  const KEY = "sidekick-settings";
  const invoke = vi.fn(async (_cmd: string, _args?: unknown) => undefined as unknown);
  let storage: NonNullable<ReturnType<typeof useSettingsStore.persist.getOptions>["storage"]>;

  beforeEach(async () => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation(async () => undefined as unknown);
    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
    const mod = await import("../store/settingsStore");
    storage = mod.useSettingsStore.persist.getOptions().storage!;
    // Hydration already ran on import; only count calls made by the tests themselves
    invoke.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("@tauri-apps/api/core");
    vi.resetModules();
    localStorage.clear();
  });

  it("getItem reads the saved settings from load_settings", async () => {
    const saved = { state: { sttMode: "groq" }, version: 0 };
    invoke.mockResolvedValueOnce(JSON.stringify(saved));

    const value = await storage.getItem(KEY);

    expect(invoke).toHaveBeenCalledWith("load_settings");
    expect(value).toEqual(saved);
  });

  it("getItem falls back to localStorage when load_settings returns null", async () => {
    const legacy = { state: { sttMode: "deepgram" }, version: 0 };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    invoke.mockResolvedValueOnce(null);

    const value = await storage.getItem(KEY);

    expect(value).toEqual(legacy);
  });

  it("setItem sends the JSON to save_settings and clears the localStorage copy", async () => {
    localStorage.setItem(KEY, "{}");
    const value = { state: { sttMode: "groq" }, version: 0 };

    await storage.setItem(KEY, value);

    expect(invoke).toHaveBeenCalledWith("save_settings", { settings: JSON.stringify(value) });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("setItem does not throw when save_settings rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("disk full"));

    await expect(storage.setItem(KEY, { state: {}, version: 0 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
