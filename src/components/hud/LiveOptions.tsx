import React from "react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { buildOptions, pickLiveOption } from "../../hooks/useLiveOptions";
import { cn } from "../../lib/utils";

const SHORTCUTS = ["⌘⌥1", "⌘⌥2", "⌘⌥3"];

/** Three numbered questions while listening: the one just asked (pinned) and likely next ones. */
export const LiveOptions: React.FC = () => {
  const isLive = useAppStore((s) => s.meetingStatus === "live");
  const asked = useSessionStore((s) => s.askedQuestion);
  const likely = useSessionStore((s) => s.likelyQuestions);
  const picked = useSessionStore((s) => s.pickedOption);
  const error = useSessionStore((s) => s.optionsError);
  const hasGroqKey = useSettingsStore((s) => Boolean(s.apiKeys.groq?.trim()));
  if (!isLive) return null;

  const options = buildOptions(asked, likely);

  return (
    <div
      role="group"
      aria-label="Suggested questions"
      data-testid="live-options"
      className="sk-surface w-full rounded-xl p-1"
    >
      {options.map((option, i) => (
        <button
          key={i}
          type="button"
          onClick={() => pickLiveOption(i)}
          aria-keyshortcuts={`Meta+Alt+${i + 1}`}
          className={cn("sk-menu-item h-auto min-h-8 py-1.5", option.text === picked && "bg-sky-500/15")}
        >
          <kbd className="sk-kbd shrink-0">{SHORTCUTS[i]}</kbd>
          <span className="min-w-0 flex-1">{option.text}</span>
          {option.asked && <span className="shrink-0 text-[11px] font-medium text-sky-300">Asked</span>}
        </button>
      ))}
      {(options.length === 0 || !hasGroqKey) && (
        <p className="px-2.5 py-1.5 sk-meta">
          {hasGroqKey
            ? "Questions appear here as the conversation goes."
            : "Add a Groq key in Settings → Keys to see likely questions."}
        </p>
      )}
      {error && <p className="px-2.5 py-1 text-[12px] text-amber-300">{error}</p>}
    </div>
  );
};
