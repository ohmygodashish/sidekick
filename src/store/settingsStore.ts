import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { invokeInTauri, safeInvoke } from "../lib/ipc";
import { getDefaultModelForProvider } from "../services/ai/dispatcher";

export type ApiProvider =
  | "openrouter"
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "deepgram";

export type SttMode = "whisper_local" | "deepgram" | "groq";

export type ThemePreference = "system" | "light" | "dark";

export type SeniorityPreset = "junior" | "mid" | "senior" | "staff" | "principal";

export type TonePreset =
  | "concise"
  | "balanced"
  | "deep"
  | "staff"
  | "system_architect";

export interface PersonalizationProfile {
  resumeText: string;
  jobDescription: string;
  targetCompany: string;
  seniorityPreset: SeniorityPreset;
  tonePreset: TonePreset;
}

export interface SettingsState {
  // API Keys (in memory only; saved to the config file via store_api_key)
  apiKeys: Record<ApiProvider, string>;

  // Model & Provider Selection
  selectedProvider: ApiProvider;
  selectedModel: string;
  evaluatorModel: string;

  // Personalization Context
  profile: PersonalizationProfile;

  // Speech-to-Text Configuration
  sttMode: SttMode;

  // Appearance
  theme: ThemePreference;

  // UI Drawer State
  isSettingsOpen: boolean;

  // Actions
  setApiKey: (provider: ApiProvider, key: string) => void;
  saveApiKeyToBackend: (provider: ApiProvider, key: string) => Promise<void>;
  saveAllApiKeysToBackend: () => Promise<void>;
  loadApiKeysFromBackend: () => Promise<void>;
  setSelectedProvider: (provider: ApiProvider) => void;
  setSelectedModel: (model: string) => void;
  setEvaluatorModel: (model: string) => void;
  setProfile: (profile: Partial<PersonalizationProfile>) => void;
  setSeniority: (seniority: SeniorityPreset) => void;
  setTone: (tone: TonePreset) => void;
  setSttMode: (mode: SttMode) => void;
  setTheme: (theme: ThemePreference) => void;
  setIsSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  resetSettings: () => void;
}

const defaultProfile: PersonalizationProfile = {
  resumeText: "",
  jobDescription: "",
  targetCompany: "",
  seniorityPreset: "senior",
  tonePreset: "balanced",
};

const defaultState = {
  apiKeys: {
    openrouter: "",
    anthropic: "",
    openai: "",
    gemini: "",
    groq: "",
    deepgram: "",
  },
  selectedProvider: "openrouter" as ApiProvider,
  selectedModel: "anthropic/claude-haiku-5.5",
  evaluatorModel: "qwen/qwen3.8-27b",
  profile: defaultProfile,
  sttMode: "whisper_local" as SttMode,
  theme: "system" as ThemePreference,
  isSettingsOpen: false,
};

// Old defaults that were replaced; migrated once when persist version goes 0 -> 1
const STALE_SELECTED_MODELS = [
  "anthropic/claude-3.5-sonnet",
  "claude-3-5-sonnet-20241022",
  "gpt-4o",
  "gemini-2.0-flash",
  "llama-3.3-70b-versatile",
];
const STALE_EVALUATOR_MODELS = ["groq/llama-3.3-70b-versatile", "llama-3.3-70b-versatile"];

// Settings live in ~/.config/sidekick/config.json (via load_settings / save_settings).
// Outside Tauri this is plain localStorage, kept synchronous so tests hydrate immediately.
const configFileStorage: StateStorage = {
  getItem: (name) => {
    if (!isTauri()) return localStorage.getItem(name);
    return invoke<string | null>("load_settings")
      .catch((err) => {
        console.warn("[Sidekick settings] load_settings failed, using localStorage:", err);
        return null;
      })
      .then((value) => value ?? localStorage.getItem(name));
  },
  setItem: (name, value) => {
    if (!isTauri()) return localStorage.setItem(name, value);
    return invoke("save_settings", { settings: value }).then(
      () => localStorage.removeItem(name),
      (err) => console.warn("[Sidekick settings] save_settings failed:", err)
    );
  },
  removeItem: (name) => {
    if (!isTauri()) return localStorage.removeItem(name);
    return invoke("save_settings", { settings: "null" }).catch((err) =>
      console.warn("[Sidekick settings] clearing settings failed:", err)
    );
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultState,

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [provider]: key.trim(),
          },
        })),

      saveApiKeyToBackend: async (provider, key) => {
        const trimmed = key.trim();
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [provider]: trimmed,
          },
        }));
        await invokeInTauri("store_api_key", { provider, key: trimmed });
      },

      saveAllApiKeysToBackend: async () => {
        const keys = get().apiKeys;
        for (const [provider, key] of Object.entries(keys)) {
          // Always propagate key to backend, including empty/cleared strings (""), so deleted keys are wiped
          await invokeInTauri("store_api_key", { provider, key: (key || "").trim() });
        }
      },

      loadApiKeysFromBackend: async () => {
        const providers: ApiProvider[] = [
          "openrouter",
          "anthropic",
          "openai",
          "gemini",
          "groq",
          "deepgram",
        ];
        for (const p of providers) {
          const val = await safeInvoke<string>("retrieve_api_key", { provider: p });
          if (val) {
            set((state) => ({
              apiKeys: { ...state.apiKeys, [p]: val },
            }));
          }
        }
      },

      // A model id from one provider fails on another, so switching provider resets the model
      setSelectedProvider: (provider) =>
        set({ selectedProvider: provider, selectedModel: getDefaultModelForProvider(provider) }),

      setSelectedModel: (model) => set({ selectedModel: model }),

      setEvaluatorModel: (model) => set({ evaluatorModel: model }),

      setProfile: (partialProfile) =>
        set((state) => ({
          profile: {
            ...state.profile,
            ...partialProfile,
          },
        })),

      setSeniority: (seniority) =>
        set((state) => ({
          profile: {
            ...state.profile,
            seniorityPreset: seniority,
          },
        })),

      setTone: (tone) =>
        set((state) => ({
          profile: {
            ...state.profile,
            tonePreset: tone,
          },
        })),

      setTheme: (theme) => set({ theme }),
      setSttMode: (mode) => {
        set({ sttMode: mode });
        safeInvoke("set_stt_engine", { engine: mode });
      },

      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

      toggleSettings: () =>
        set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      resetSettings: () => {
        // Keep API keys: a reset followed by "Save keys" would otherwise delete them from the config file
        set((state) => ({ ...defaultState, apiKeys: state.apiKeys }));
        safeInvoke("set_stt_engine", { engine: defaultState.sttMode });
      },
    }),
    {
      name: "sidekick-settings",
      version: 1,
      migrate: (persisted, fromVersion) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        if (fromVersion < 1) {
          if (STALE_EVALUATOR_MODELS.includes(state.evaluatorModel ?? "")) {
            state.evaluatorModel = defaultState.evaluatorModel;
          }
          if (STALE_SELECTED_MODELS.includes(state.selectedModel ?? "")) {
            state.selectedModel = getDefaultModelForProvider(state.selectedProvider ?? "openrouter");
          }
        }
        return state as SettingsState;
      },
      storage: createJSONStorage(() => configFileStorage),
      partialize: (state) => {
        // Keys are excluded here; they are saved separately via store_api_key.
        const { apiKeys: _ignored, isSettingsOpen: _ignored2, ...persistedState } = state;
        return persistedState;
      },
    }
  )
);
