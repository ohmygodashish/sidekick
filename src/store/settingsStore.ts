import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { safeInvoke } from "../lib/ipc";

export type ApiProvider =
  | "openrouter"
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "deepgram";

export type SttMode = "whisper_local" | "deepgram" | "groq";

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
  selectedModel: "anthropic/claude-3.5-sonnet",
  evaluatorModel: "groq/llama-3.3-70b-versatile",
  profile: defaultProfile,
  sttMode: "whisper_local" as SttMode,
  isSettingsOpen: false,
};

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
        await safeInvoke("store_api_key", { provider, key: trimmed });
      },

      saveAllApiKeysToBackend: async () => {
        const keys = get().apiKeys;
        for (const [provider, key] of Object.entries(keys)) {
          // Always propagate key to backend, including empty/cleared strings (""), so deleted keys are wiped
          await safeInvoke("store_api_key", { provider, key: (key || "").trim() });
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

      setSelectedProvider: (provider) => set({ selectedProvider: provider }),

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
      storage: createJSONStorage(() => configFileStorage),
      partialize: (state) => {
        // Keys are excluded here; they are saved separately via store_api_key.
        const { apiKeys: _ignored, isSettingsOpen: _ignored2, ...persistedState } = state;
        return persistedState;
      },
    }
  )
);
