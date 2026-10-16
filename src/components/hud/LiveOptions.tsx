import React, { useLayoutEffect, useRef, useState } from "react";
import { WandSparkles } from "lucide-react";
import { useAppStore, runAssist } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { buildOptions, pickLiveOption } from "../../hooks/useLiveOptions";
import { usePresence, EXIT_MS } from "../../hooks/usePresence";
import { getShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { ScreenToggle } from "./ScreenToggle";
import { Tip } from "./Tip";

const SHORTCUTS = ["⌘⌥1", "⌘⌥2", "⌘⌥3"];

/** Option text that cross-fades: the old text fades out on top of the new one fading in */
const FadeText: React.FC<{ text: string }> = ({ text }) => {
  const [old, setOld] = useState<string | null>(null);
  const last = useRef(text);
  useLayoutEffect(() => {
    if (last.current === text) return;
    setOld(last.current);
    last.current = text;
    const id = setTimeout(() => setOld(null), EXIT_MS);
    return () => clearTimeout(id);
  }, [text]);
  return (
    <span className="grid min-w-0 flex-1">
      {old !== null && (
        <span key={old} aria-hidden="true" className="sk-fade-out col-start-1 row-start-1">
          {old}
        </span>
      )}
      <span key={text} className="sk-fade col-start-1 row-start-1">
        {text}
      </span>
    </span>
  );
};

/** Three numbered questions while listening: the one just asked (pinned) and likely next ones. */
export const LiveOptions: React.FC = () => {
  const isLive = useAppStore((s) => s.meetingStatus === "live");
  const asked = useSessionStore((s) => s.askedQuestion);
  const likely = useSessionStore((s) => s.likelyQuestions);
  const picked = useSessionStore((s) => s.pickedOption);
  const optionsUseScreen = useSessionStore((s) => s.optionsUseScreen);
  const error = useSessionStore((s) => s.optionsError);
  const hasGroqKey = useSettingsStore((s) => Boolean(s.apiKeys.groq?.trim()));
  const presence = usePresence(isLive);
  if (!presence.mounted) return null;

  const options = buildOptions(asked, likely);

  return (
    <div
      role="group"
      aria-label="Suggested questions"
      data-testid="live-options"
      data-state={presence.state}
      inert={presence.state === "closed"}
      className="sk-surface sk-pop w-full rounded-xl p-1"
    >
      <div className="flex items-center justify-end gap-1 px-1 pb-1 pt-0.5">
        <ScreenToggle
          on={optionsUseScreen}
          onChange={(on) => useSessionStore.setState({ optionsUseScreen: on })}
        />
        <Tip label="Assist" keys={getShortcut("assist").keys}>
          <button type="button" className="sk-btn" onClick={runAssist}>
            <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Assist
          </button>
        </Tip>
      </div>
      {options.map((option, i) => (
        <button
          key={i}
          type="button"
          onClick={() => pickLiveOption(i)}
          aria-keyshortcuts={`Meta+Alt+${i + 1}`}
          className={cn("sk-menu-item h-auto min-h-8 py-1.5", option.text === picked && "bg-sk-accent-tint")}
        >
          <kbd className="sk-kbd shrink-0">{SHORTCUTS[i]}</kbd>
          <FadeText text={option.text} />
          {option.asked && <span className="shrink-0 text-[11px] font-medium text-sk-accent">Asked</span>}
        </button>
      ))}
      {(options.length === 0 || !hasGroqKey) && (
        <p className="px-2.5 py-1.5 sk-meta">
          {hasGroqKey
            ? "Questions appear here as the conversation goes."
            : "Add a Groq key in Settings → General to see likely questions."}
        </p>
      )}
      {error && <p className="px-2.5 py-1 text-[12px] text-sk-warn">{error}</p>}
    </div>
  );
};
