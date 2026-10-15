import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionStore, DetectedQuestion } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  detectQuestion,
  QuestionDetectionPayload,
  QuestionDetectorOptions,
} from "../services/ai/questionDetector";

export interface UseQuestionDetectorOptions {
  onQuestionDetected?: (payload: QuestionDetectionPayload) => void;
  onDeepSolve?: (question: DetectedQuestion) => void;
  enabled?: boolean;
  allowCandidate?: boolean;
}

export function useQuestionDetector(options?: UseQuestionDetectorOptions) {
  const { onQuestionDetected, onDeepSolve, enabled = true, allowCandidate } = options || {};
  const [isEvaluating, setIsEvaluating] = useState(false);
  const activeQuestion = useSessionStore((s) => s.activeQuestion);

  const lastEvaluatedTurnIdRef = useRef<string | null>(null);

  const triggerDeepSolve = useCallback(
    (questionToSolve?: DetectedQuestion | null) => {
      const targetQuestion = questionToSolve || useSessionStore.getState().activeQuestion;
      if (!targetQuestion) return;

      onDeepSolve?.(targetQuestion);

      // Window event only: a Tauri emit echoes back to this webview and cancelled the solve
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("sidekick:deep_solve", {
            detail: targetQuestion,
          })
        );
      }
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

  // Subscribe to STT turns from the interviewer (and the candidate only when explicitly allowed)
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = useSessionStore.subscribe((state) => {
      const transcript = state.transcript;
      if (transcript.length === 0) return;

      const latestTurn = transcript[transcript.length - 1];
      if (latestTurn.speaker === "candidate" && !allowCandidate) return;
      if (latestTurn.id === lastEvaluatedTurnIdRef.current) return;

      lastEvaluatedTurnIdRef.current = latestTurn.id;
      evaluateTurn(latestTurn.text);
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, evaluateTurn, allowCandidate]);

  // Global hotkeys: Enter or Cmd+Enter to trigger Deep Solve when activeQuestion is set (REQ-012)
  useEffect(() => {
    if (!enabled || !activeQuestion) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.altKey || e.shiftKey) return;

      // Controls, fields, dialogs and menus handle Enter themselves (buttons, follow-up box, settings)
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest?.('[role="dialog"], [role="menu"]'))
      ) {
        return;
      }

      e.preventDefault();
      triggerDeepSolve(activeQuestion);
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
