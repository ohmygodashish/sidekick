import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ApiProvider =
  | "openrouter"
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "deepgram";

export type SttMode = "whisper_local" | "deepgram" | "groq";

export type SeniorityPreset = "junior" | "mid" | "senior" | "staff" | "principal";

export type TonePreset = "concise" | "balanced" | "deep";

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

  // Actions
  setApiKey: (provider: ApiProvider, key: string) => void;
  setSelectedProvider: (provider: ApiProvider) => void;
  setSelectedModel: (model: string) => void;
  setEvaluatorModel: (model: string) => void;
  setProfile: (profile: Partial<PersonalizationProfile>) => void;
  setSeniority: (seniority: SeniorityPreset) => void;
  setTone: (tone: TonePreset) => void;
  setSttMode: (mode: SttMode) => void;
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
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultState,

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [provider]: key.trim(),
          },
        })),

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

      setSttMode: (mode) => set({ sttMode: mode }),

      resetSettings: () => set(defaultState),
    }),
    {
      name: "sidekick-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Exclude apiKeys from localStorage per Global Constraint #5 & SEC-001.
        // API keys remain strictly in-memory until Task 13 wires native macOS Keychain.
        const { apiKeys: _ignored, ...persistedState } = state;
        return persistedState;
      },
    }
  )
);
