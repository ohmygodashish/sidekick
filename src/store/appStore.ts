import { create } from "zustand";
import { invokeInTauri, safeInvoke } from "../lib/ipc";
import { ASSIST_LABEL } from "../services/ai/promptTemplates";
import { requestSolve, useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";

// "dynamic_notch" now means compact view (bar only); the name is kept for Rust and saved settings.
export type LayoutMode = "floating_hud" | "dynamic_notch";

export type MeetingStatus = "idle" | "starting" | "live" | "stopping";

export interface AudioLevels {
  interviewer: number; // 0-1
  candidate: number; // 0-1
}

export interface SttError {
  message: string;
  recovered: boolean; // a cloud failure the local model covered
}

export const STOP_FAILED_MESSAGE = "Couldn't stop listening. Try again, or press ⌘Esc to stop everything.";

const ZERO_LEVELS: AudioLevels = { interviewer: 0, candidate: 0 };
// Idle also clears what only means something while listening
const MEETING_IDLE = {
  meetingStatus: "idle" as MeetingStatus,
  meetingStartedAt: null,
  audioLevels: ZERO_LEVELS,
  sttError: null as SttError | null,
};

export interface AppState {
  layoutMode: LayoutMode;
  opacity: number; // 0.15 to 1.0, default 0.85
  isClickThrough: boolean; // default false
  isVisible: boolean; // default false
  isPanicked: boolean; // default false
  meetingStatus: MeetingStatus; // audio is captured only while "live"
  meetingStartedAt: number | null;
  meetingError: string | null;
  audioLevels: AudioLevels;
  sttError: SttError | null;
  isAskOpen: boolean; // answer panel opened by Ask with no detected question
  askFocusRequest: number; // bumped by the Ask button only: the panel focuses its box once per bump

  // Actions
  setLayoutMode: (mode: LayoutMode) => Promise<void>;
  toggleLayoutMode: () => Promise<void>;
  setOpacity: (opacity: number) => Promise<void>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<void>;
  triggerPanic: () => Promise<void>;
  syncFromBackend: () => Promise<void>;
  startMeeting: () => Promise<void>;
  stopMeeting: () => Promise<void>;
  setAskOpen: (open: boolean) => void;
  hideWindow: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  layoutMode: "floating_hud",
  opacity: 0.85,
  isClickThrough: false,
  isVisible: false,
  isPanicked: false,
  meetingStatus: "idle",
  meetingStartedAt: null,
  meetingError: null,
  audioLevels: ZERO_LEVELS,
  sttError: null,
  isAskOpen: false,
  askFocusRequest: 0,

  setLayoutMode: async (mode: LayoutMode) => {
    set({ layoutMode: mode });
    // Rust accepts kebab-case or snake_case
    await safeInvoke("set_layout_mode", { mode: mode.replace("_", "-") });
  },

  toggleLayoutMode: async () => {
    const nextMode: LayoutMode =
      get().layoutMode === "floating_hud" ? "dynamic_notch" : "floating_hud";
    set({ layoutMode: nextMode });
    await safeInvoke("set_layout_mode", { mode: nextMode.replace("_", "-") });
  },

  setOpacity: async (rawOpacity: number) => {
    const clamped = Math.min(1.0, Math.max(0.15, Number(rawOpacity.toFixed(2))));
    set({ opacity: clamped });
    await safeInvoke("set_window_opacity", { alpha: clamped });
  },

  setClickThrough: async (enabled: boolean) => {
    set({ isClickThrough: enabled });
    await safeInvoke("set_click_through", { enabled });
  },

  toggleClickThrough: async () => {
    const next = !get().isClickThrough;
    set({ isClickThrough: next });
    await safeInvoke("set_click_through", { enabled: next });
  },

  triggerPanic: async () => {
    set({ isPanicked: true, isVisible: false, ...MEETING_IDLE });
    useSessionStore.getState().clearThreads();
    await safeInvoke("trigger_panic");
  },

  startMeeting: async () => {
    if (get().meetingStatus !== "idle") return;
    set({ meetingStatus: "starting", meetingError: null, sttError: null });
    try {
      // Warnings name the sources that did not start; outside Tauri there is nothing to start
      const warnings = (await invokeInTauri<string[]>("start_audio_capture", { config: null })) ?? [];
      set({
        meetingStatus: "live",
        meetingStartedAt: Date.now(),
        meetingError: warnings.length > 0 ? warnings.join(" ") : null,
      });
    } catch (err) {
      // A panic during start cancels it; that isn't an error to show next time
      set({ ...MEETING_IDLE, meetingError: get().isPanicked ? null : String(err) });
    }
  },

  stopMeeting: async () => {
    if (get().meetingStatus !== "live") return;
    set({ meetingStatus: "stopping", meetingError: null });
    try {
      await invokeInTauri("stop_audio_capture");
      set({ ...MEETING_IDLE, meetingError: null });
      // This meeting's chat history goes with it
      useSessionStore.getState().clearThreads();
    } catch {
      // Capture may still be running, so stay live and say so
      set({ meetingStatus: "live", meetingError: STOP_FAILED_MESSAGE });
    }
  },

  setAskOpen: (open: boolean) => set({ isAskOpen: open }),

  hideWindow: async () => {
    set({ isVisible: false });
    // Rust hides the window and hands keyboard focus back; outside Tauri safeInvoke is a no-op
    await safeInvoke("hide_window");
  },

  syncFromBackend: async () => {
    interface HotkeySnapshot {
      is_panicked: boolean;
      is_click_through: boolean;
      layout_mode: string;
      opacity: number;
    }

    const snapshot = await safeInvoke<HotkeySnapshot>("get_hotkey_state");
    if (snapshot) {
      const modeNormalized = (snapshot.layout_mode || "").toLowerCase().includes("notch")
        ? "dynamic_notch"
        : "floating_hud";

      set({
        isPanicked: snapshot.is_panicked,
        isClickThrough: snapshot.is_click_through,
        layoutMode: modeNormalized,
        opacity: Math.min(1.0, Math.max(0.15, snapshot.opacity)),
      });
    }
  },
}));

/** Start when idle, stop when live (⇧⌘\). While starting or stopping there is nothing to do. */
export async function toggleMeeting(): Promise<void> {
  const { meetingStatus, startMeeting, stopMeeting } = useAppStore.getState();
  if (meetingStatus === "live") await stopMeeting();
  else if (meetingStatus === "idle") await startMeeting();
}

/** Sends the typed Ask question: it continues the active thread, or starts one. */
export function submitTypedAsk(): void {
  const session = useSessionStore.getState();
  const question = session.askDraft.trim();
  if (!question) return;
  useSessionStore.setState({ askDraft: "" });
  useAppStore.getState().setAskOpen(false);
  // Ask may have the keyboard; hand it back to the app underneath
  safeInvoke("release_focus");
  requestSolve({ question, kind: "typed", captureWindow: session.askUsesScreen });
}

/**
 * New chat (⌘R and the panel's button): ends the active thread, which stays in History, and leaves
 * Ask open and empty. Focus is not moved.
 */
export function startNewChat(): void {
  useSessionStore.getState().clearAnswer();
  useSessionStore.setState({ askDraft: "" });
  useAppStore.getState().setAskOpen(true);
}

/** Assist (⌘↵): answers now from the screen and the recent conversation, in a new thread, without taking focus. */
export function runAssist(): void {
  useSettingsStore.getState().setIsSettingsOpen(false);
  useSessionStore.setState({ pickedOption: null });
  const app = useAppStore.getState();
  if (app.layoutMode === "dynamic_notch") app.setLayoutMode("floating_hud");
  app.setAskOpen(false);
  safeInvoke("release_focus");
  requestSolve({ question: ASSIST_LABEL, kind: "assist", newThread: true, captureWindow: true });
}

/**
 * Subscribes to Tauri backend events to synchronize hotkeys and window state.
 * Returns an unlisten function for cleanup on component unmount.
 */
export async function setupAppEventListeners(): Promise<() => void> {
  const unlisteners: (() => void)[] = [];

  try {
    const { listen } = await import("@tauri-apps/api/event");

    // 1. Panic event (Cmd + Esc)
    const unlistenPanic = await listen<{ action: string; timestamp: number }>(
      "sidekick://panic",
      () => {
        // Rust purges and stops audio on panic, so the meeting is over
        useAppStore.setState({ isPanicked: true, isVisible: false, ...MEETING_IDLE });
        useSessionStore.getState().clearThreads();
      }
    );
    unlisteners.push(unlistenPanic);

    // 2. Visibility toggled event (Cmd + \)
    // Showing opens the Ask box too, but never focuses it: showing Sidekick must not take the keyboard
    const handleVisibility = (payload: { visible: boolean }) => {
      useAppStore.setState({
        isVisible: payload.visible,
        ...(payload.visible ? { isPanicked: false, isAskOpen: true } : {}),
      });
    };

    const unlistenVis = await listen<{ visible: boolean }>(
      "sidekick://visibility_toggled",
      (e) => handleVisibility(e.payload)
    );
    unlisteners.push(unlistenVis);

    // 3. Click-through toggled event (Cmd + Shift + C)
    const handleClickThrough = (payload: { enabled: boolean }) => {
      useAppStore.setState({ isClickThrough: payload.enabled });
    };

    const unlistenClick = await listen<{ enabled: boolean }>(
      "sidekick://click_through_toggled",
      (e) => handleClickThrough(e.payload)
    );
    unlisteners.push(unlistenClick);

    // 4. Layout mode toggled event (Cmd + Shift + M)
    const unlistenLayout = await listen<{ mode: string; mode_str?: string }>(
      "sidekick://toggle_layout_mode",
      (e) => {
        const modeStr = (e.payload.mode || e.payload.mode_str || "").toLowerCase();
        const mode: LayoutMode = modeStr.includes("notch")
          ? "dynamic_notch"
          : "floating_hud";
        useAppStore.setState({ layoutMode: mode });
      }
    );
    unlisteners.push(unlistenLayout);

    // 5. Opacity changed event
    const unlistenOpacity = await listen<{ opacity: number }>(
      "sidekick://opacity_changed",
      (e) => {
        if (typeof e.payload.opacity === "number") {
          const clamped = Math.min(1.0, Math.max(0.15, e.payload.opacity));
          useAppStore.setState({ opacity: clamped });
        }
      }
    );
    unlisteners.push(unlistenOpacity);

    // 6. STT Chunk event (sidekick://stt_chunk)
    const unlistenStt = await listen<{
      id: string;
      speaker: "interviewer" | "candidate";
      text: string;
      timestamp: number;
      is_final: boolean;
    }>("sidekick://stt_chunk", (e) => {
      if (e.payload && e.payload.text) {
        // Speech came through, so an earlier transcription error no longer applies
        useAppStore.setState({ sttError: null });
        useSessionStore.getState().addTranscriptTurn({
          id: e.payload.id,
          speaker: e.payload.speaker,
          text: e.payload.text,
          timestamp: e.payload.timestamp,
        });
      }
    });
    unlisteners.push(unlistenStt);

    // Live levels, about 10 per second while listening
    const unlistenLevel = await listen<AudioLevels>("sidekick://audio_level", (e) => {
      if (useAppStore.getState().meetingStatus === "live") useAppStore.setState({ audioLevels: e.payload });
    });
    unlisteners.push(unlistenLevel);

    // Speech-to-text failures (Rust never invents text, it reports instead)
    const unlistenSttError = await listen<SttError>("sidekick://stt_error", (e) => {
      useAppStore.setState({ sttError: { message: e.payload.message, recovered: e.payload.recovered } });
    });
    unlisteners.push(unlistenSttError);

    // 7. Session Burned event (sidekick://session_burned)
    const unlistenBurned = await listen<{ timestamp?: number }>(
      "sidekick://session_burned",
      () => {
        useSessionStore.getState().clearSession();
        // burn_session purges and stops audio capture too
        useAppStore.setState(MEETING_IDLE);
      }
    );
    unlisteners.push(unlistenBurned);

    // 8. Start or stop listening (Shift + Cmd + \)
    const unlistenToggle = await listen("sidekick://toggle_meeting", () => {
      void toggleMeeting();
    });
    unlisteners.push(unlistenToggle);

    // 9. Settings (Cmd + ,)
    const unlistenSettings = await listen("sidekick://open_settings", () => {
      useSettingsStore.getState().toggleSettings();
    });
    unlisteners.push(unlistenSettings);

    // 10. New chat (Cmd + R): ends the thread and resets Ask to empty, without moving focus
    const unlistenNewChat = await listen("sidekick://new_chat", () => startNewChat());
    unlisteners.push(unlistenNewChat);

    // 11. Assist (⌘↵): sends the typed follow-up if its box is showing and has text, otherwise answers now
    const unlistenAssist = await listen("sidekick://assist", () => {
      // The follow-up box shows while Ask is open or a chat is open
      // Settings and compact view hide the answer panel, so its box counts as hidden then
      const boxShowing =
        !useSettingsStore.getState().isSettingsOpen &&
        useAppStore.getState().layoutMode !== "dynamic_notch" &&
        (useAppStore.getState().isAskOpen || useSessionStore.getState().activeThreadId !== null);
      if (boxShowing && useSessionStore.getState().askDraft.trim()) submitTypedAsk();
      else runAssist();
    });
    unlisteners.push(unlistenAssist);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[Sidekick Events] Failed to bind Tauri event listeners:", err);
    }
  }

  return () => {
    unlisteners.forEach((unlisten) => {
      try {
        unlisten();
      } catch (err) {
        console.error("Error unlistening event:", err);
      }
    });
  };
}
