import { useState, useCallback, useRef, useEffect } from "react";
import { useSessionStore, DetectedQuestion, ProgressiveSolution } from "../store/sessionStore";
import { useSettingsStore, ApiProvider } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { captureActiveWindow } from "../lib/ipc";
import { buildSystemPrompt, buildUserPrompt } from "../services/ai/promptTemplates";
import { dispatchDeepSolve, getDefaultModelForProvider } from "../services/ai/dispatcher";

export interface SolveOptions {
  captureWindow?: boolean;
  provider?: ApiProvider;
  model?: string;
  forceMock?: boolean;
}

export interface UseDeepSolverOptions {
  onStart?: (question: DetectedQuestion | string) => void;
  onProgress?: (solution: ProgressiveSolution) => void;
  onComplete?: (solution: ProgressiveSolution) => void;
  onError?: (err: Error) => void;
  onCancel?: () => void;
  enabled?: boolean;
}

export function useDeepSolver(options?: UseDeepSolverOptions) {
  const { onStart, onProgress, onComplete, onError, onCancel, enabled = true } =
    options || {};

  const [isSolving, setIsSolving] = useState(false);
  const [streamingStage, setStreamingStage] = useState<1 | 2 | 3 | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isSolvingRef = useRef(false);

  /**
   * Synchronously cancels in-flight fetch streams (< 25ms, REQ-004 / AC-002).
   */
  const cancelSolve = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isSolvingRef.current = false;
    setIsSolving(false);
    setStreamingStage(null);
    onCancel?.();
  }, [onCancel]);

  /**
   * Executes deep solve pipeline with vision capture and progressive streaming (REQ-014, REQ-015).
   */
  const solveQuestion = useCallback(
    async (
      questionInput?: DetectedQuestion | string | null,
      solveOptions?: SolveOptions
    ) => {
      // Abort immediately if system is in panicked stealth state
      if (useAppStore.getState().isPanicked) {
        cancelSolve();
        return;
      }

      // If already solving, cancel previous in-flight stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Resolve question object and text
      let questionObj: DetectedQuestion | null = null;
      let questionText = "";
      let quickPointers: string[] = [];

      if (!questionInput) {
        questionObj = useSessionStore.getState().activeQuestion;
        if (!questionObj) {
          return;
        }
        questionText = questionObj.extractedQuestion || questionObj.rawTranscript;
        quickPointers = questionObj.quickPointers || [];
      } else if (typeof questionInput === "string") {
        questionText = questionInput.trim();
        questionObj = {
          questionId: `q_${Date.now()}`,
          timestamp: Date.now(),
          confidence: 1.0,
          rawTranscript: questionText,
          extractedQuestion: questionText,
          quickPointers: [],
        };
      } else {
        questionObj = questionInput;
        questionText = questionObj.extractedQuestion || questionObj.rawTranscript;
        quickPointers = questionObj.quickPointers || [];
      }

      if (!questionText) return;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isSolvingRef.current = true;
      setIsSolving(true);
      setError(null);
      setStreamingStage(1);

      onStart?.(questionObj || questionText);

      try {
        // 1. Silent Active Window Capture (REQ-013, AC-003)
        let imageBase64: string | undefined;
        const shouldCapture = solveOptions?.captureWindow ?? true;

        if (shouldCapture) {
          try {
            const capture = await captureActiveWindow();
            if (capture?.base64_image) {
              imageBase64 = capture.base64_image;
            }
          } catch {
            // Silently proceed without screenshot if capture unavailable
          }
        }

        // Check if aborted during capture
        if (controller.signal.aborted) return;

        // 2. Resolve settings and configuration
        const settings = useSettingsStore.getState();
        const provider = solveOptions?.provider || settings.selectedProvider || "openrouter";
        const apiKey = settings.apiKeys[provider] || "";
        const model =
          solveOptions?.model || settings.selectedModel || getDefaultModelForProvider(provider);
        const profile = settings.profile;

        // 3. Assemble personalized prompts (REQ-016)
        const systemPrompt = buildSystemPrompt(profile);
        const prompt = buildUserPrompt(questionText, {
          quickPointers,
          transcript: questionObj?.rawTranscript,
          hasImage: Boolean(imageBase64),
        });

        // 4. Dispatch with progressive update handler
        const finalSolution = await dispatchDeepSolve({
          provider,
          apiKey,
          model,
          prompt,
          systemPrompt,
          imageBase64,
          questionId: questionObj?.questionId,
          signal: controller.signal,
          forceMock: solveOptions?.forceMock,
          onProgressiveUpdate: (progressiveUpdate) => {
            if (controller.signal.aborted) return;

            // Stream update into sessionStore for UI rendering
            useSessionStore.getState().setSolution(progressiveUpdate);

            // Compute active streaming stage indicator
            if (progressiveUpdate.stage3Analysis) {
              setStreamingStage(3);
            } else if (progressiveUpdate.stage2Code) {
              setStreamingStage(2);
            } else if (progressiveUpdate.stage1Intuition) {
              setStreamingStage(1);
            }

            onProgress?.(progressiveUpdate);
          },
        });

        if (controller.signal.aborted) return;

        // Store final parsed solution
        useSessionStore.getState().setSolution(finalSolution);
        onComplete?.(finalSolution);
      } catch (err: any) {
        if (controller.signal.aborted || err.name === "AbortError") {
          return;
        }
        const errMsg = err?.message || "Failed to solve problem";
        setError(errMsg);
        onError?.(err);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        isSolvingRef.current = false;
        setIsSolving(false);
        setStreamingStage(null);
      }
    },
    [cancelSolve, onStart, onProgress, onComplete, onError]
  );

  // Synchronous Panic Killswitch Watcher (< 25ms, REQ-004, AC-002)
  useEffect(() => {
    // 1. Subscribe to appStore panic state
    const unsubscribePanicStore = useAppStore.subscribe((state) => {
      if (state.isPanicked && isSolvingRef.current) {
        cancelSolve();
      }
    });

    // 2. Global window event listener
    const handlePanicEvent = () => {
      cancelSolve();
    };
    window.addEventListener("sidekick:panic", handlePanicEvent);

    return () => {
      unsubscribePanicStore();
      window.removeEventListener("sidekick:panic", handlePanicEvent);
    };
  }, [cancelSolve]);

  // Listen for Tauri sidekick://panic event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        return listen("sidekick://panic", () => {
          cancelSolve();
        });
      })
      .then((unsub) => {
        unlisten = unsub;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [cancelSolve]);

  // Listen for deep solve triggers (CustomEvent or Tauri event)
  useEffect(() => {
    if (!enabled) return;

    const handleWindowDeepSolve = (e: Event) => {
      const customEvent = e as CustomEvent<DetectedQuestion | undefined>;
      solveQuestion(customEvent.detail);
    };

    window.addEventListener("sidekick:deep_solve", handleWindowDeepSolve);

    let unlistenTauri: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        return listen<DetectedQuestion>("sidekick://deep_solve_triggered", (e) => {
          solveQuestion(e.payload);
        });
      })
      .then((unsub) => {
        unlistenTauri = unsub;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("sidekick:deep_solve", handleWindowDeepSolve);
      unlistenTauri?.();
    };
  }, [enabled, solveQuestion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  return {
    solveQuestion,
    cancelSolve,
    isSolving,
    streamingStage,
    error,
  };
}
