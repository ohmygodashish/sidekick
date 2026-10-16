import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { invokeInTauri, safeInvoke } from "../lib/ipc";
import { modelFor, SOLUTION_MODELS } from "../services/ai/models";
import { CODING_MODE_ID, GENERAL_MODE_ID, type CustomMode } from "../services/ai/modes";
import { useSessionStore } from "./sessionStore";

export type ApiProvider = "openrouter" | "anthropic" | "openai" | "groq";

/** Providers that answer questions. Groq only runs live options and speech-to-text. */
export type SolutionProvider = Exclude<ApiProvider, "groq">;

export type SttMode = "whisper_local" | "groq";

export type ThemePreference = "system" | "light" | "dark";

/** How hard the answer model thinks when thinking is on (Claude models only). */
export type ThinkingLevel = "low" | "medium" | "high";

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
  selectedProvider: SolutionProvider;
  /** Each provider keeps its own chosen model, so switching provider keeps them all */
  selectedModels: Record<SolutionProvider, string>;

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

  // Thinking for answers: typed questions and Assist; option picks and the slot-1 prefetch also need pickThinking
  answerThinking: boolean;
  answerThinkingLevel: ThinkingLevel;
  pickThinking: boolean;

  // Appearance
  theme: ThemePreference;

  // UI Drawer State
  isSettingsOpen: boolean;

  // Actions
  setApiKey: (provider: ApiProvider, key: string) => void;
  saveApiKeyToBackend: (provider: ApiProvider, key: string) => Promise<void>;
  loadApiKeysFromBackend: () => Promise<void>;
  setSelectedProvider: (provider: SolutionProvider) => void;
  setProviderModel: (provider: SolutionProvider, model: string) => void;
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
  setAnswerThinking: (on: boolean) => void;
  setAnswerThinkingLevel: (level: ThinkingLevel) => void;
  setPickThinking: (on: boolean) => void;
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
    groq: "",
  },
  selectedProvider: "openrouter" as SolutionProvider,
  selectedModels: {
    anthropic: modelFor("anthropic"),
    openai: modelFor("openai"),
    openrouter: modelFor("openrouter"),
  },
  profile: defaultProfile,
  sttMode: "whisper_local" as SttMode,
  sttLanguage: "en" as SttLanguage,
  sttLanguageNotice: null as string | null,
  micDeviceName: null as string | null,
  modes: [] as CustomMode[],
  activeModeId: GENERAL_MODE_ID,
  outputLanguage: "English",
  answerThinking: true,
  answerThinkingLevel: "medium" as ThinkingLevel,
  pickThinking: false,
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

      loadApiKeysFromBackend: async () => {
        const providers: ApiProvider[] = ["openrouter", "anthropic", "openai", "groq"];
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

      setProviderModel: (provider, model) =>
        set((state) => ({ selectedModels: { ...state.selectedModels, [provider]: model } })),

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
      setAnswerThinking: (on) => set({ answerThinking: on }),
      setAnswerThinkingLevel: (level) => set({ answerThinkingLevel: level }),
      setPickThinking: (on) => set({ pickThinking: on }),

      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

      toggleSettings: () =>
        set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      resetSettings: () => {
        const previousMode = get().activeModeId;
        // Keep API keys and custom modes: keys live in the config file, and a reset must not blank the fields that save them
        set((state) => ({ ...defaultState, apiKeys: state.apiKeys, modes: state.modes }));
        followModeScreen(previousMode, defaultState.activeModeId);
        void safeInvoke("set_stt_engine", { engine: defaultState.sttMode }).then(pushSttLanguage);
        void pushMicDevice();
      },
    }),
    {
      name: "sidekick-settings",
      version: 5,
      migrate: (persisted, fromVersion) => {
        // selectedModel and evaluatorModel are v4 keys: v5 reads selectedModel once, then drops both
        const state = (persisted ?? {}) as Partial<SettingsState> & { selectedModel?: string; evaluatorModel?: string };
        if (fromVersion < 2) {
          // Modes, languages and the microphone start at their defaults
          state.modes ??= defaultState.modes;
          state.activeModeId ??= defaultState.activeModeId;
          state.sttLanguage ??= defaultState.sttLanguage;
          state.outputLanguage ??= defaultState.outputLanguage;
          state.micDeviceName ??= defaultState.micDeviceName;
        }
        if (fromVersion < 3) {
          // Thinking starts at its defaults; a choice saved earlier is kept
          state.answerThinking ??= defaultState.answerThinking;
          state.answerThinkingLevel ??= defaultState.answerThinkingLevel;
          state.pickThinking ??= defaultState.pickThinking;
        }
        if (fromVersion < 4) {
          // Deepgram speech-to-text moves to Groq
          if ((state.sttMode as string | undefined) === "deepgram") state.sttMode = "groq";
        }
        if (fromVersion < 5) {
          // Groq and Gemini answers are gone: any other provider falls back to OpenRouter. The old model
          // goes to the active provider, and an unlisted one becomes that provider's default.
          const known = ["anthropic", "openai", "openrouter"] as const;
          const provider = known.find((p) => p === state.selectedProvider) ?? "openrouter";
          state.selectedProvider = provider;
          state.selectedModels = {
            ...defaultState.selectedModels,
            [provider]: modelFor(provider, state.selectedModel),
          };
          delete state.selectedModel;
          delete state.evaluatorModel;
        }
        return state as SettingsState;
      },
      // The config file can be hand-edited: an unknown provider would break answers and Settings, so it falls back
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SettingsState>) };
        if (!Object.prototype.hasOwnProperty.call(SOLUTION_MODELS, merged.selectedProvider)) merged.selectedProvider = current.selectedProvider;
        merged.selectedModels = { ...current.selectedModels, ...merged.selectedModels };
        return merged;
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
