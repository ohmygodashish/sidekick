import React, { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useSessionStore, DetectedQuestion } from "../../store/sessionStore";
import { useAppStore } from "../../store/appStore";
import { ProgressiveCard } from "../cards/ProgressiveCard";

const dispatchSolve = (question: DetectedQuestion) =>
  window.dispatchEvent(new CustomEvent("sidekick:deep_solve", { detail: question }));

export const AnswerPanel: React.FC = () => {
  const activeQuestion = useSessionStore((s) => s.activeQuestion);
  const stage1 = useSessionStore((s) => s.stage1Intuition);
  const stage2 = useSessionStore((s) => s.stage2Code);
  const stage3 = useSessionStore((s) => s.stage3Analysis);
  const isSolving = useSessionStore((s) => s.isSolving);
  const solveError = useSessionStore((s) => s.solveError);
  const isAskOpen = useAppStore((s) => s.isAskOpen);
  const setAskOpen = useAppStore((s) => s.setAskOpen);

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAskOpen) inputRef.current?.focus();
  }, [isAskOpen]);

  const hasSolution = Boolean(stage1 || stage2 || stage3);
  if (!activeQuestion && !hasSolution && !isSolving && !solveError && !isAskOpen) return null;

  const question = activeQuestion ? activeQuestion.extractedQuestion || activeQuestion.rawTranscript : "";

  const close = () => {
    window.dispatchEvent(new Event("sidekick:cancel_solve"));
    useSessionStore.getState().setActiveQuestion(null);
    useSessionStore.getState().setSolution(null);
    useSessionStore.setState({ solveError: null, pickedOption: null });
    setAskOpen(false);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const followUp: DetectedQuestion = {
      questionId: `q_${Date.now()}`,
      timestamp: Date.now(),
      confidence: 1,
      rawTranscript: text,
      extractedQuestion: text,
      quickPointers: [],
    };
    useSessionStore.getState().setActiveQuestion(followUp);
    setAskOpen(false);
    dispatchSolve(followUp);
    setDraft("");
  };

  let body: React.ReactNode = null;
  if (solveError) {
    body = (
      <div
        role="alert"
        className="sk-fade flex items-start gap-2 rounded-lg bg-sk-danger-tint px-3 py-2 text-[13px] text-sk-danger"
      >
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{solveError}</span>
        {activeQuestion && (
          <button
            type="button"
            onClick={() => dispatchSolve(activeQuestion)}
            className="sk-btn-secondary ml-auto"
          >
            Retry
          </button>
        )}
      </div>
    );
  } else if (hasSolution || isSolving) {
    body = (
      <>
        {hasSolution && <ProgressiveCard />}
        {isSolving && (
          <p className="sk-fade flex items-center gap-2 sk-meta">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Thinking…
          </p>
        )}
      </>
    );
  }

  return (
    <section aria-label="Answer" className="sk-panel sk-pop min-h-0">
      <div className="flex items-start gap-2 px-4 pt-3">
        <p className="sk-meta line-clamp-2 min-w-0 flex-1 pt-1.5">{question || "Ask anything"}</p>
        <button type="button" onClick={close} aria-label="Close" title="Close" className="sk-icon-btn">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {body && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-2 sk-scroll">{body}</div>
      )}

      <form
        className="px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <input
            ref={inputRef}
            aria-label="Ask a follow-up"
            placeholder={activeQuestion || hasSolution ? "Ask a follow-up…" : "Type a question…"}
            className="sk-field pr-10"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter and Cmd+Enter both submit; the global shortcut ignores inputs
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <kbd className="sk-kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">↵</kbd>
        </div>
      </form>
    </section>
  );
};
