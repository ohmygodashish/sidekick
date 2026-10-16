import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { invokeInTauri, safeInvoke } from "../lib/ipc";
import { getDefaultModelForProvider } from "../services/ai/dispatcher";
import { CODING_MODE_ID, GENERAL_MODE_ID, type CustomMode } from "../services/ai/modes";
import { useSessionStore } from "./sessionStore";

export type ApiProvider =
  | "openrouter"
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "deepgram";

export type SttMode = "whisper_local" | "deepgram" | "groq";

export type ThemePreference = "system" | "light" | "dark";

/** Transcription languages; "auto" lets the engine detect the language. */
export const STT_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
] as const;

export type SttLanguage = (typeof STT_LANGUAGES)[number]["code"];

/** Answer languages, by name: the transcription list without Auto-detect. */
export const OUTPUT_LANGUAGES = STT_LANGUAGES.filter((l) => l.code !== "auto").map((l) => l.name);

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
  sttLanguage: SttLanguage;
  /** Rust's note about the transcription language, e.g. the on-device model is English-only; not saved */
  sttLanguageNotice: string | null;
  micDeviceName: string | null; // null = system default

  // Modes: presets are built in; these are the custom ones
  modes: CustomMode[];
  activeModeId: string;
  outputLanguage: string;

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
  setSttLanguage: (language: SttLanguage) => void;
  setMicDevice: (name: string | null) => Promise<void>;
  addMode: (name: string, prompt: string) => string;
  updateMode: (id: string, changes: Partial<Pick<CustomMode, "name" | "prompt">>) => void;
  deleteMode: (id: string) => void;
  setActiveMode: (id: string) => void;
  setOutputLanguage: (language: string) => void;
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
  sttLanguage: "en" as SttLanguage,
  sttLanguageNotice: null as string | null,
  micDeviceName: null as string | null,
  modes: [] as CustomMode[],
  activeModeId: GENERAL_MODE_ID,
  outputLanguage: "English",
  theme: "system" as ThemePreference,
  isSettingsOpen: false,
};

/** Sends the microphone choice to Rust (null = system default). It applies from the next Start. */
export async function pushMicDevice(): Promise<void> {
  await safeInvoke("set_mic_device", { name: useSettingsStore.getState().micDeviceName });
}

/** Sends the transcription language; Rust answers with a note when the engine can't honour it. */
export async function pushSttLanguage(): Promise<void> {
  const { sttLanguage } = useSettingsStore.getState();
  const notice = await safeInvoke<string>("set_stt_language", { language: sttLanguage });
  // A newer change may have landed while Rust answered; its own push sets the note
  if (useSettingsStore.getState().sttLanguage === sttLanguage) {
    useSettingsStore.setState({ sttLanguageNotice: notice });
  }
}

/** Coding turns the options' screen on; leaving Coding turns it off. Other mode changes leave it alone. */
function followModeScreen(from: string, to: string) {
  if ((from === CODING_MODE_ID) !== (to === CODING_MODE_ID)) {
    useSessionStore.setState({ optionsUseScreen: to === CODING_MODE_ID });
  }
}

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
        // The engine can change what the chosen language needs: Rust checks it after the engine is set
        void safeInvoke("set_stt_engine", { engine: mode }).then(pushSttLanguage);
      },
      setSttLanguage: (language) => {
        set({ sttLanguage: language });
        void pushSttLanguage();
      },
      setMicDevice: (name) => {
        set({ micDeviceName: name });
        return pushMicDevice();
      },

      addMode: (name, prompt) => {
        const id = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        set((state) => ({ modes: [...state.modes, { id, name: name.trim(), prompt: prompt.trim() }] }));
        return id;
      },
      updateMode: (id, changes) =>
        set((state) => ({ modes: state.modes.map((m) => (m.id === id ? { ...m, ...changes } : m)) })),
      deleteMode: (id) =>
        set((state) => ({
          modes: state.modes.filter((m) => m.id !== id),
          activeModeId: state.activeModeId === id ? GENERAL_MODE_ID : state.activeModeId,
        })),
      setActiveMode: (id) => {
        followModeScreen(get().activeModeId, id);
        set({ activeModeId: id });
      },
      setOutputLanguage: (language) => set({ outputLanguage: language }),

      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

      toggleSettings: () =>
        set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      resetSettings: () => {
        const previousMode = get().activeModeId;
        // Keep API keys and custom modes: a reset followed by "Save keys" would otherwise delete the keys from the config file
        set((state) => ({ ...defaultState, apiKeys: state.apiKeys, modes: state.modes }));
        followModeScreen(previousMode, defaultState.activeModeId);
        void safeInvoke("set_stt_engine", { engine: defaultState.sttMode }).then(pushSttLanguage);
        void pushMicDevice();
      },
    }),
    {
      name: "sidekick-settings",
      version: 2,
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
        if (fromVersion < 2) {
          // Modes, languages and the microphone start at their defaults
          state.modes ??= defaultState.modes;
          state.activeModeId ??= defaultState.activeModeId;
          state.sttLanguage ??= defaultState.sttLanguage;
          state.outputLanguage ??= defaultState.outputLanguage;
          state.micDeviceName ??= defaultState.micDeviceName;
        }
        return state as SettingsState;
      },
      storage: createJSONStorage(() => configFileStorage),
      partialize: (state) => {
        // Keys are excluded here; they are saved separately via store_api_key. The STT note is live, not saved.
        const {
          apiKeys: _ignored,
          isSettingsOpen: _ignored2,
          sttLanguageNotice: _ignored3,
          ...persistedState
        } = state;
        return persistedState;
      },
    }
  )
);
