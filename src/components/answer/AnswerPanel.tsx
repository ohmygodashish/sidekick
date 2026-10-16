import React, { useCallback, useEffect, useRef } from "react";
import { CircleAlert, LoaderCircle, Monitor, SquarePen, X } from "lucide-react";
import {
  activeThreadOf,
  requestSolve,
  ThreadMessage,
  useSessionStore,
} from "../../store/sessionStore";
import { startNewChat, submitTypedAsk, useAppStore } from "../../store/appStore";
import { safeInvoke } from "../../lib/ipc";
import { getShortcut } from "../../lib/shortcuts";
import { ProgressiveCard } from "../cards/ProgressiveCard";
import { ScreenToggle } from "../hud/ScreenToggle";
import { Tip } from "../hud/Tip";
import { HistoryMenu } from "./HistoryMenu";

// Within this many pixels of the bottom, new content keeps the view on the latest message
const NEAR_BOTTOM_PX = 48;

interface ExchangeProps {
  message: ThreadMessage;
  latest: boolean;
  streaming: boolean;
  onRetry: (message: ThreadMessage) => void;
}

// Memoized: while one answer streams, only that exchange re-renders
const Exchange = React.memo(({ message, latest, streaming, onRetry }: ExchangeProps) => (
  <div className="sk-fade space-y-3">
    <p className="sk-meta">{message.question}</p>
    {message.viewedScreen && (
      <p className="sk-meta flex items-center gap-1.5">
        <Monitor className="h-3 w-3" aria-hidden="true" />
        Viewed screen
      </p>
    )}
    {message.error && (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg bg-sk-danger-tint px-3 py-2 text-[13px] text-sk-danger"
      >
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{message.error}</span>
        {latest && (
          <button type="button" onClick={() => onRetry(message)} className="sk-btn-secondary ml-auto">
            Retry
          </button>
        )}
      </div>
    )}
    <ProgressiveCard solution={message.solution} />
    {streaming && (
      <p role="status" className="sk-fade flex items-center gap-2 sk-meta">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Thinking…
      </p>
    )}
  </div>
));

// Last Ask request focused. Module-level so a panel remounted after settings or compact view doesn't refocus it
let focusedAskRequest = 0;

export const AnswerPanel: React.FC = () => {
  const thread = useSessionStore(activeThreadOf);
  const solvingMessageId = useSessionStore((s) => s.solvingMessageId);
  const askDraft = useSessionStore((s) => s.askDraft);
  const askUsesScreen = useSessionStore((s) => s.askUsesScreen);
  const isAskOpen = useAppStore((s) => s.isAskOpen);
  const askFocusRequest = useAppStore((s) => s.askFocusRequest);
  const setAskOpen = useAppStore((s) => s.setAskOpen);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  // Focus the box only when the Ask button asked for it: opening it (on show) must not take the keyboard
  useEffect(() => {
    if (askFocusRequest === focusedAskRequest) return;
    focusedAskRequest = askFocusRequest;
    inputRef.current?.focus();
  }, [askFocusRequest]);

  // ⇧⌘↑/↓ from Rust: a third of the visible answer, stopping at either end; smooth unless the user asks for less motion
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ direction: "up" | "down" }>("sidekick://scroll_answer", (e) => {
          const el = scrollRef.current;
          if (!el) return;
          // Room left in that direction; at an end there is nothing to scroll, so a press does nothing
          const down = e.payload.direction === "down";
          const room = down ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
          if (room < 1) return;
          // Scrolling up leaves the bottom: new content must not pull the view back down while it streams
          if (!down) nearBottom.current = false;
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const step = Math.min(el.clientHeight / 3, room);
          el.scrollBy({
            top: down ? step : -step,
            behavior: reduced ? "auto" : "smooth",
          });
        })
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // A thread opens at its latest message; within a thread, new content follows only while the user is near the bottom
  useEffect(() => {
    nearBottom.current = true;
  }, [thread?.id]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [thread]);

  // Reruns a failed message in place; it keeps a screenshot only if it had one
  const retry = useCallback(
    (message: ThreadMessage) =>
      requestSolve({
        question: message.question,
        kind: message.kind,
        captureWindow: message.viewedScreen || message.kind === "assist",
        retryMessageId: message.id,
      }),
    []
  );

  if (!thread && !isAskOpen) return null;

  const messages = thread?.messages ?? [];
  const latestId = messages[messages.length - 1]?.id;

  // Ends the answer on screen and the active thread (it stays in History) and closes Ask
  const closeChat = () => {
    useSessionStore.getState().clearAnswer();
    setAskOpen(false);
  };

  return (
    <section aria-label="Answer" className="sk-panel sk-pop min-h-0">
      {/* px-3 matches the Ask box's form: 12px in from each edge, so Close's centre lines up with the screen toggle */}
      <div className="flex items-center justify-between gap-1 px-3 pt-3">
        <div className="flex items-center gap-1">
          <Tip label="New chat" keys={getShortcut("new_chat").keys}>
            <button
              type="button"
              className="sk-icon-btn rounded-lg"
              aria-label="New chat"
              disabled={!thread}
              onClick={startNewChat}
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tip>
          <HistoryMenu />
        </div>
        <Tip label="Close">
          <button type="button" className="sk-icon-btn rounded-lg" aria-label="Close" onClick={closeChat}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Tip>
      </div>

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
          }}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-3 pt-2 sk-scroll"
        >
          {messages.map((message) => (
            <Exchange
              key={message.id}
              message={message}
              latest={message.id === latestId}
              streaming={message.id === solvingMessageId}
              onRetry={retry}
            />
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 px-3 pb-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submitTypedAsk();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            aria-label="Ask a follow-up"
            placeholder={thread ? "Ask a follow-up…" : "Ask about your screen or type a question…"}
            className="sk-field pr-28"
            value={askDraft}
            onChange={(e) => useSessionStore.setState({ askDraft: e.target.value })}
            onKeyDown={(e) => {
              // Enter submits. ⌘↵ is the global Assist shortcut (sidekick://assist), so it normally never reaches here
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitTypedAsk();
              } else if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                // Close the box and give keyboard focus back to the app underneath
                e.preventDefault();
                setAskOpen(false);
                inputRef.current?.blur();
                safeInvoke("release_focus");
              }
            }}
          />
          {/* Empty draft: ⌘↵ Assist (answers from the screen). Typed text: ↵ Send */}
          <span className="sk-meta pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {askDraft.trim() ? (
              <>
                <kbd className="sk-kbd">↵</kbd>
                Send
              </>
            ) : (
              <>
                <span className="flex gap-0.5">
                  {getShortcut("assist").keys.map((key) => (
                    <kbd key={key} className="sk-kbd">
                      {key}
                    </kbd>
                  ))}
                </span>
                Assist
              </>
            )}
          </span>
        </div>
        <ScreenToggle
          className="rounded-lg"
          on={askUsesScreen}
          onChange={(on) => useSessionStore.setState({ askUsesScreen: on })}
        />
      </form>
    </section>
  );
};
