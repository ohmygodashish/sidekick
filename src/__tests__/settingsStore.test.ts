import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSettingsStore, type SettingsState } from "../store/settingsStore";
import * as ipc from "../lib/ipc";

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
    expect(state.selectedModels).toEqual({
      openrouter: "anthropic/claude-haiku-5.5",
      anthropic: "claude-haiku-5-5",
      openai: "gpt-6-luna",
    });
    expect(state.sttMode).toBe("whisper_local");
    expect(state.profile.seniorityPreset).toBe("senior");
    expect(state.profile.tonePreset).toBe("balanced");
    expect(state.answerThinking).toBe(true);
    expect(state.answerThinkingLevel).toBe("medium");
    expect(state.pickThinking).toBe(false);
  });

  it("sets the thinking switches and level", () => {
    const { setAnswerThinking, setAnswerThinkingLevel, setPickThinking } = useSettingsStore.getState();
    setAnswerThinking(false);
    setAnswerThinkingLevel("high");
    setPickThinking(true);

    expect(useSettingsStore.getState()).toMatchObject({
      answerThinking: false,
      answerThinkingLevel: "high",
      pickThinking: true,
    });
  });

  it("should update API keys correctly", () => {
    useSettingsStore.getState().setApiKey("openrouter", "sk-or-v1-testkey123");
    useSettingsStore.getState().setApiKey("anthropic", "sk-ant-testkey456");

    const { apiKeys } = useSettingsStore.getState();
    expect(apiKeys.openrouter).toBe("sk-or-v1-testkey123");
    expect(apiKeys.anthropic).toBe("sk-ant-testkey456");
    expect(apiKeys.openai).toBe("");
  });

  it("keeps each provider's own model when the provider changes", () => {
    const { setSelectedProvider, setProviderModel } = useSettingsStore.getState();
    setSelectedProvider("openai");
    setProviderModel("openai", "gpt-6.1-sol");
    setSelectedProvider("openrouter");

    expect(useSettingsStore.getState().selectedProvider).toBe("openrouter");
    expect(useSettingsStore.getState().selectedModels).toMatchObject({
      openai: "gpt-6.1-sol",
      openrouter: "anthropic/claude-haiku-5.5",
    });
  });

  it("throws when a key cannot be saved to the backend", async () => {
    vi.spyOn(ipc, "invokeInTauri").mockRejectedValueOnce(new Error("disk full"));

    await expect(useSettingsStore.getState().saveApiKeyToBackend("openai", "sk-test")).rejects.toThrow("disk full");
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
    useSettingsStore.getState().setSttMode("groq");
    expect(useSettingsStore.getState().sttMode).toBe("groq");

    useSettingsStore.getState().setSttMode("whisper_local");
    expect(useSettingsStore.getState().sttMode).toBe("whisper_local");
  });

  it("should reset settings to default values", () => {
    useSettingsStore.getState().setApiKey("groq", "test_groq_key");
    useSettingsStore.getState().setSeniority("principal");
    useSettingsStore.getState().setAnswerThinking(false);
    useSettingsStore.getState().setAnswerThinkingLevel("high");
    useSettingsStore.getState().setPickThinking(true);

    useSettingsStore.getState().resetSettings();

    const state = useSettingsStore.getState();
    // Keys survive a reset, so the General tab never saves blanked fields over them
    expect(state.apiKeys.groq).toBe("test_groq_key");
    expect(state.profile.seniorityPreset).toBe("senior");
    expect(state).toMatchObject({ answerThinking: true, answerThinkingLevel: "medium", pickThinking: false });
  });

  it("should exclude apiKeys from localStorage per SEC-001 partialize rule", () => {
    useSettingsStore.getState().setApiKey("openai", "sk-secret-test-key-should-not-persist");
    useSettingsStore.getState().setProviderModel("openai", "gpt-6.1-sol");

    const raw = localStorage.getItem("sidekick-settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // State in localStorage must not have apiKeys
    expect(parsed.state.apiKeys).toBeUndefined();
    expect(parsed.state.selectedModels.openai).toBe("gpt-6.1-sol");
    // In-memory state still retains the key
    expect(useSettingsStore.getState().apiKeys.openai).toBe("sk-secret-test-key-should-not-persist");
  });
});

describe("persisted settings migration (version 2 -> 3)", () => {
  const migrate = useSettingsStore.persist.getOptions().migrate!;

  it("fills the thinking settings with their defaults and keeps everything else", () => {
    const migrated = migrate({ sttMode: "groq", outputLanguage: "German" }, 2) as SettingsState;

    expect(migrated).toMatchObject({
      answerThinking: true,
      answerThinkingLevel: "medium",
      pickThinking: false,
      sttMode: "groq",
      outputLanguage: "German",
    });
  });

  it("keeps thinking choices saved before the switch existed", () => {
    const migrated = migrate(
      { answerThinking: false, answerThinkingLevel: "high", pickThinking: true },
      2
    ) as SettingsState;

    expect(migrated).toMatchObject({ answerThinking: false, answerThinkingLevel: "high", pickThinking: true });
  });
});

describe("settings migration to version 4 (Deepgram removed)", () => {
  const migrate = useSettingsStore.persist.getOptions().migrate!;

  it("moves Deepgram speech-to-text to Groq", () => {
    const migrated = migrate({ sttMode: "deepgram" }, 3) as SettingsState;

    expect(migrated.sttMode).toBe("groq");
  });
});

describe("settings migration to version 5 (one model per provider)", () => {
  const migrate = useSettingsStore.persist.getOptions().migrate!;

  it("is persisted at version 5", () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(5);
  });

  it("moves a Groq answer provider to OpenRouter with its default model", () => {
    const migrated = migrate({ selectedProvider: "groq", selectedModel: "openai/gpt-oss-120b" }, 4) as SettingsState;

    expect(migrated.selectedProvider).toBe("openrouter");
    expect(migrated.selectedModels.openrouter).toBe("anthropic/claude-haiku-5.5");
  });

  it("keeps a listed model and replaces an unlisted one with its provider's default", () => {
    const anthropic = migrate({ selectedProvider: "anthropic", selectedModel: "claude-opus-5-5" }, 4) as SettingsState;
    expect(anthropic.selectedModels.anthropic).toBe("claude-opus-5-5");

    const openai = migrate({ selectedProvider: "openai", selectedModel: "gpt-5.6-luna" }, 4) as SettingsState;
    expect(openai.selectedModels.openai).toBe("gpt-6-luna");
  });

  it("drops the old single-model keys and keeps the other providers on their defaults", () => {
    const migrated = migrate(
      { selectedProvider: "openrouter", selectedModel: "anthropic/claude-sonnet-5.5", evaluatorModel: "groq/x" },
      4
    ) as SettingsState;

    expect("selectedModel" in migrated).toBe(false);
    expect("evaluatorModel" in migrated).toBe(false);
    expect(migrated.selectedModels).toEqual({
      openrouter: "anthropic/claude-sonnet-5.5",
      anthropic: "claude-haiku-5-5",
      openai: "gpt-6-luna",
    });
  });

  it("leaves a version 5 state alone", () => {
    const state = { sttMode: "groq", selectedProvider: "anthropic", selectedModels: { anthropic: "claude-opus-5-5" } };

    expect(migrate({ ...state }, 5)).toEqual(state);
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
    const legacy = { state: { sttMode: "whisper_local" }, version: 3 };
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

describe("loading a hand-edited config", () => {
  const merge = useSettingsStore.persist.getOptions().merge!;

  it("falls back from an unknown provider and fills missing models", () => {
    const current = useSettingsStore.getState();
    const merged = merge({ selectedProvider: "groq", selectedModels: null }, current) as SettingsState;
    expect(merged.selectedProvider).toBe(current.selectedProvider);
    expect(merged.selectedModels).toEqual(current.selectedModels);

    const kept = merge({ selectedProvider: "openai", selectedModels: { openai: "gpt-6.1-sol" } }, current) as SettingsState;
    expect(kept.selectedProvider).toBe("openai");
    expect(kept.selectedModels.openai).toBe("gpt-6.1-sol");
    expect(kept.selectedModels.anthropic).toBe(current.selectedModels.anthropic);
  });
});
