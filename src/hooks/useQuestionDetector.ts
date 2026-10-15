import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionStore, DetectedQuestion } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  detectQuestion,
  QuestionDetectionPayload,
  QuestionDetectorOptions,
} from "../services/ai/questionDetector";
import { safeEmit } from "../lib/ipc";

export interface UseQuestionDetectorOptions {
  onQuestionDetected?: (payload: QuestionDetectionPayload) => void;
  onDeepSolve?: (question: DetectedQuestion) => void;
  enabled?: boolean;
}

export function useQuestionDetector(options?: UseQuestionDetectorOptions) {
  const { onQuestionDetected, onDeepSolve, enabled = true } = options || {};
  const [isEvaluating, setIsEvaluating] = useState(false);
  const activeQuestion = useSessionStore((s) => s.activeQuestion);

  const lastEvaluatedTurnIdRef = useRef<string | null>(null);

  const triggerDeepSolve = useCallback(
    (questionToSolve?: DetectedQuestion | null) => {
      const targetQuestion = questionToSolve || useSessionStore.getState().activeQuestion;
      if (!targetQuestion) return;

      onDeepSolve?.(targetQuestion);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("sidekick:deep_solve", {
            detail: targetQuestion,
          })
        );
      }

      safeEmit("sidekick://deep_solve_triggered", targetQuestion).catch(() => {});
    },
    [onDeepSolve]
  );

  const evaluateTurn = useCallback(
    async (text: string, evalOptions?: QuestionDetectorOptions) => {
      if (!text || !text.trim()) return null;
      setIsEvaluating(true);
      try {
        const groqKey = useSettingsStore.getState().apiKeys.groq;
        const evaluatorModel = useSettingsStore.getState().evaluatorModel;

        const result = await detectQuestion(text, {
          apiKey: groqKey,
          model: evaluatorModel,
          ...evalOptions,
        });

        if (result && result.confidence >= 0.7) {
          useSessionStore.getState().setActiveQuestion(result);
          onQuestionDetected?.(result);

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("sidekick:question_detected", { detail: result })
            );
          }
          safeEmit("sidekick://question_detected", result).catch(() => {});
        }

        return result;
      } catch (err) {
        console.error("[useQuestionDetector] Error evaluating transcript turn:", err);
        return null;
      } finally {
        setIsEvaluating(false);
      }
    },
    [onQuestionDetected]
  );

  // Subscribe to STT turns from Channel 0 (Interviewer)
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = useSessionStore.subscribe((state) => {
      const transcript = state.transcript;
      if (transcript.length === 0) return;

      const latestTurn = transcript[transcript.length - 1];
      // Channel 0 is Interviewer (REQ-008, REQ-011)
      if (latestTurn.speaker !== "interviewer") return;
      if (latestTurn.id === lastEvaluatedTurnIdRef.current) return;

      lastEvaluatedTurnIdRef.current = latestTurn.id;
      evaluateTurn(latestTurn.text);
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, evaluateTurn]);

  // Global hotkeys: Enter or Cmd+Enter to trigger Deep Solve when activeQuestion is set (REQ-012)
  useEffect(() => {
    if (!enabled || !activeQuestion) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      const isCmdEnter = (e.metaKey || e.ctrlKey) && e.key === "Enter";
      const isPlainEnter =
        !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "Enter";

      // If user is inside an input field, only Cmd+Enter triggers Deep Solve.
      // If outside an input field, both Enter and Cmd+Enter trigger Deep Solve.
      if (isCmdEnter || (!isInput && isPlainEnter)) {
        e.preventDefault();
        triggerDeepSolve(activeQuestion);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, activeQuestion, triggerDeepSolve]);

  return {
    isEvaluating,
    activeQuestion,
    evaluateTurn,
    triggerDeepSolve,
  };
}
