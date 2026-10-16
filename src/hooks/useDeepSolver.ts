import { useCallback, useRef, useEffect } from "react";
import { useSessionStore, MessageKind, MessagePatch, SolveRequest } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { captureActiveWindow } from "../lib/ipc";
import {
  ASSIST_LABEL,
  ASSIST_TASK,
  Exchange,
  buildUserPrompt,
  currentSystemParts,
  solutionToText,
} from "../services/ai/promptTemplates";
import {
  dispatchDeepSolve,
  getDefaultModelForProvider,
  mimeTypeOfDataUrl,
  reasoningFor,
} from "../services/ai/dispatcher";
import { assistTurns, formatTranscript, formatTurns } from "../services/ai/liveOptions";
import { initPrefetch, takePrefetch } from "./prefetch";

type SolveOptions = Omit<SolveRequest, "question">;

/** The solve that is running now, and the message it streams into. */
interface InFlight {
  controller: AbortController;
  threadId: string;
  messageId: string;
}

const setSolving = (solvingMessageId: string | null) => useSessionStore.setState({ solvingMessageId });

/** Only Assist and option picks send the conversation; a typed question is sent as written. */
function transcriptFor(kind: MessageKind): string {
  const turns = useSessionStore.getState().transcript;
  if (kind === "option") return formatTranscript(turns);
  if (kind === "assist") return formatTurns(assistTurns(turns));
  return "";
}

/**
 * Answers the solve requests from requestSolve(): adds the question to a thread and streams the answer
 * into that message (REQ-014, REQ-015). Mounted once in App.
 */
export function useDeepSolver() {
  const inFlightRef = useRef<InFlight | null>(null);
  const lastSolveTimeRef = useRef<number>(0);
  const lastSolveTextRef = useRef<string>("");

  /**
   * Stops the running solve synchronously (< 25ms, REQ-004 / AC-002). Its message is removed if nothing
   * was answered yet, or marked as stopped if it has a partial answer.
   */
  const cancelSolve = useCallback(() => {
    const inFlight = inFlightRef.current;
    if (!inFlight) return;
    inFlightRef.current = null;
    inFlight.controller.abort();
    useSessionStore.getState().stopMessage(inFlight.threadId, inFlight.messageId);
    setSolving(null);
  }, []);

  const solveQuestion = useCallback(
    async (question: string, solveOptions?: SolveOptions) => {
      // Abort immediately if system is in panicked stealth state
      if (useAppStore.getState().isPanicked) {
        cancelSolve();
        return;
      }

      const questionText = question.trim();
      if (!questionText) return;

      // 500ms duplicate solve guard
      const now = Date.now();
      if (questionText === lastSolveTextRef.current && now - lastSolveTimeRef.current < 500) {
        return;
      }
      lastSolveTimeRef.current = now;
      lastSolveTextRef.current = questionText;

      // A new solve supersedes the running one, which stops where it is
      cancelSolve();

      const kind: MessageKind = solveOptions?.kind ?? "typed";
      // A pick takes the prefetched answer to its question, when the screen is off for it. A retry reruns in place
      const prefetch =
        kind === "option" && !solveOptions?.retryMessageId && !useSessionStore.getState().optionsUseScreen
          ? takePrefetch(questionText)
          : null;

      const begun = useSessionStore.getState().beginMessage({
        question: kind === "assist" ? ASSIST_LABEL : questionText,
        kind,
        newThread: solveOptions?.newThread ?? false,
        retryMessageId: solveOptions?.retryMessageId,
      });
      if (!begun) return;
      const { threadId, messageId } = begun;
      const updateMessage = (patch: MessagePatch) =>
        useSessionStore.getState().updateMessage(threadId, messageId, patch);

      // A finished prefetch is the answer already: no request
      if (prefetch?.status === "done") {
        updateMessage({ solution: prefetch.solution });
        return;
      }

      // An adopted prefetch is the in-flight solve from here on, so the abort paths below stop it too
      const controller = prefetch?.controller ?? new AbortController();
      inFlightRef.current = { controller, threadId, messageId };
      setSolving(messageId);

      try {
        if (prefetch) {
          // Still running: it streams into this message from wherever it has got to
          prefetch.onUpdate = (solution) => updateMessage({ solution });
          if (prefetch.solution) updateMessage({ solution: prefetch.solution });
          const solution = await prefetch.finished;
          if (!controller.signal.aborted) updateMessage({ solution });
          return;
        }

        // 1. Silent active window capture (REQ-013, AC-003), started first. A failed capture just means no
        //    screenshot; the prompt parts below are built while it runs
        const shouldCapture = solveOptions?.captureWindow ?? true;
        const capture = shouldCapture ? captureActiveWindow().catch(() => null) : Promise.resolve(null);

        // 2. Resolve settings and configuration
        const settings = useSettingsStore.getState();
        const provider = settings.selectedProvider || "openrouter";
        const apiKey = settings.apiKeys[provider] || "";
        const model = settings.selectedModel || getDefaultModelForProvider(provider);

        // 3. Assemble personalized prompts (REQ-016); earlier answers of the thread are the follow-up context
        const { prefix: systemPrefix, suffix: systemSuffix } = currentSystemParts(settings);
        const history: Exchange[] = begun.before.flatMap((m) =>
          m.solution ? [{ question: m.question, answer: solutionToText(m.solution) }] : []
        );
        const transcript = transcriptFor(kind);

        const imageBase64 = (await capture)?.base64_image || undefined;
        if (controller.signal.aborted) return;
        updateMessage({ viewedScreen: Boolean(imageBase64) });

        const prompt = buildUserPrompt(kind === "assist" ? ASSIST_TASK : questionText, {
          transcript,
          hasImage: Boolean(imageBase64),
          history,
        });

        // 4. Dispatch; each progressive update streams into the message
        const finalSolution = await dispatchDeepSolve({
          provider,
          apiKey,
          model,
          prompt,
          systemPrefix,
          systemSuffix,
          reasoning: reasoningFor(kind, settings),
          imageBase64,
          imageMimeType: imageBase64 ? mimeTypeOfDataUrl(imageBase64) : undefined,
          questionId: messageId,
          signal: controller.signal,
          onProgressiveUpdate: (progressiveUpdate) => {
            if (controller.signal.aborted) return;
            updateMessage({ solution: progressiveUpdate });
          },
        });

        if (controller.signal.aborted) return;
        updateMessage({ solution: finalSolution });
      } catch (err: any) {
        if (controller.signal.aborted || err.name === "AbortError") return;
        updateMessage({ error: err?.message || "Failed to solve problem" });
      } finally {
        // Only the solve that is still running clears its state
        if (inFlightRef.current?.controller === controller) {
          inFlightRef.current = null;
          setSolving(null);
        }
      }
    },
    [cancelSolve]
  );

  // Synchronous Panic Killswitch Watcher (< 25ms, REQ-004, AC-002)
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      if (state.isPanicked) cancelSolve();
    });
  }, [cancelSolve]);

  // Listen for Tauri sidekick://panic event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("sidekick://panic", () => cancelSolve()))
      .then((unsub) => {
        unlisten = unsub;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [cancelSolve]);

  // Solve requests (requestSolve) and cancels arrive as window events
  useEffect(() => {
    const handleWindowDeepSolve = (e: Event) => {
      const request = (e as CustomEvent<SolveRequest | undefined>).detail;
      if (request) solveQuestion(request.question, request);
    };

    // Closing the answer panel cancels the stream so the answer doesn't reappear later
    window.addEventListener("sidekick:deep_solve", handleWindowDeepSolve);
    window.addEventListener("sidekick:cancel_solve", cancelSolve);

    return () => {
      window.removeEventListener("sidekick:deep_solve", handleWindowDeepSolve);
      window.removeEventListener("sidekick:cancel_solve", cancelSolve);
    };
  }, [solveQuestion, cancelSolve]);

  // Unmount: stop whatever is still streaming
  useEffect(() => cancelSolve, [cancelSolve]);

  // The slot-1 prefetch follows the asked question (hooks/prefetch.ts)
  useEffect(() => initPrefetch(), []);
}
