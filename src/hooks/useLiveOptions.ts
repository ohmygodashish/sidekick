import { useEffect } from "react";
import { useSessionStore, requestSolve } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { safeInvoke } from "../lib/ipc";
import { fetchLiveOptions, liveOptionsErrorMessage } from "../services/ai/liveOptions";
import { resolveMode } from "../services/ai/modes";

export interface LiveOption {
  text: string;
  asked: boolean;
}

/** Slot 1 is the asked question when there is one; the rest are likely next questions. */
export function buildOptions(asked: string | null, likely: string[]): LiveOption[] {
  const options: LiveOption[] = asked ? [{ text: asked, asked: true }] : [];
  for (const text of likely) {
    if (options.length === 3) break;
    options.push({ text, asked: false });
  }
  return options;
}

/** Answers option `index` (0-2): from a click or the global Cmd+Option+1/2/3. Starts a new thread. */
export function pickLiveOption(index: number) {
  const session = useSessionStore.getState();
  const option = buildOptions(session.askedQuestion, session.likelyQuestions)[index];
  if (!option) return;

  useSessionStore.setState({ pickedOption: option.text });

  useSettingsStore.getState().setIsSettingsOpen(false);
  const app = useAppStore.getState();
  if (app.layoutMode === "dynamic_notch") app.setLayoutMode("floating_hud");
  app.setAskOpen(false);
  // A hotkey pick can close Ask while its input has the keyboard; hand it back
  safeInvoke("release_focus");
  requestSolve({ question: option.text, kind: "option", newThread: true, captureWindow: session.optionsUseScreen });
}

/**
 * Keeps the three live options current: after every transcript turn it asks for the asked
 * question and likely next ones. One request at a time; turns that land meanwhile trigger
 * one rerun with the latest transcript.
 */
export function useLiveOptions() {
  useEffect(() => {
    let inFlight: AbortController | null = null;
    let rerun = false;
    let lastTurnId: string | null = null;

    const run = async () => {
      if (inFlight) {
        rerun = true;
        return;
      }
      const turns = useSessionStore.getState().transcript;
      if (turns.length === 0) return;

      const controller = new AbortController();
      inFlight = controller;
      const { apiKeys, evaluatorModel, activeModeId, modes } = useSettingsStore.getState();
      try {
        const result = await fetchLiveOptions(turns, {
          apiKey: apiKeys.groq,
          model: evaluatorModel,
          signal: controller.signal,
          mode: resolveMode(activeModeId, modes),
        });
        if (controller.signal.aborted) return;
        useSessionStore.setState((s) => ({
          askedQuestion: result.asked ?? s.askedQuestion,
          // Without a Groq key there are no predictions; keep whatever is there
          likelyQuestions: result.likely.length > 0 ? result.likely : s.likelyQuestions,
          optionsError: null,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn("[useLiveOptions] fetching options failed:", err);
        useSessionStore.setState({ optionsError: liveOptionsErrorMessage(err) });
      } finally {
        if (inFlight === controller) inFlight = null;
        if (rerun && !controller.signal.aborted) {
          rerun = false;
          run();
        }
      }
    };

    const unsubscribe = useSessionStore.subscribe((state) => {
      const latest = state.transcript[state.transcript.length - 1];
      if (!latest) {
        // Session cleared: drop a pending answer so it can't refill the options
        inFlight?.abort();
        inFlight = null;
        rerun = false;
        lastTurnId = null;
        return;
      }
      if (latest.id === lastTurnId) return;
      lastTurnId = latest.id;
      run();
    });

    // StrictMode mounts twice in dev; drop a listener that resolves after cleanup
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ index: number }>("sidekick://pick_option", (e) => pickLiveOption(e.payload.index))
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe();
      unlisten?.();
      inFlight?.abort();
    };
  }, []);
}
