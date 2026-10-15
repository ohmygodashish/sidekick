import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
  // API Keys (secure in memory + persistent local storage fallback; Keychain sync in Task 13)
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

      resetSettings: () => set(defaultState),
    }),
    {
      name: "sidekick-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Exclude apiKeys from localStorage per Global Constraint #5 & SEC-001.
        // API keys remain strictly in-memory until Task 13 wires native macOS Keychain.
        const { apiKeys: _ignored, isSettingsOpen: _ignored2, ...persistedState } = state;
        return persistedState;
      },
    }
  )
);
