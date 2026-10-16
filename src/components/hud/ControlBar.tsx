import React, { useEffect, useState } from "react";
import { EyeOff, LoaderCircle, Mic, Sparkles } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { BarMenu } from "./BarMenu";
import { Tip } from "./Tip";
import { cn } from "../../lib/utils";
import { getShortcut } from "../../lib/shortcuts";

// m:ss under an hour, h:mm:ss after
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** System audio (sky) and microphone (orange): each dot brightens with its live level. */
const LevelDots: React.FC = () => {
  const levels = useAppStore((state) => state.audioLevels);
  const dot = "h-1.5 w-1.5 rounded-full transition-opacity duration-100";
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className={cn(dot, "bg-sk-system")} style={{ opacity: 0.25 + 0.75 * levels.interviewer }} />
      <span className={cn(dot, "bg-sk-mic")} style={{ opacity: 0.25 + 0.75 * levels.candidate }} />
    </span>
  );
};

const MeetingButton: React.FC = () => {
  const meetingStatus = useAppStore((state) => state.meetingStatus);
  const meetingStartedAt = useAppStore((state) => state.meetingStartedAt);
  const startMeeting = useAppStore((state) => state.startMeeting);
  const stopMeeting = useAppStore((state) => state.stopMeeting);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (meetingStatus !== "live") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [meetingStatus]);

  const isLive = meetingStatus === "live";
  const isBusy = meetingStatus === "starting" || meetingStatus === "stopping";
  const toggleListening = getShortcut("toggle_listening");

  let content: React.ReactNode;
  if (isBusy) {
    content = (
      <>
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {meetingStatus === "starting" ? "Starting…" : "Stopping…"}
      </>
    );
  } else if (isLive) {
    content = (
      <>
        <LevelDots />
        Stop
        <span className="tabular-nums text-sk-fg-3">{formatElapsed(now - (meetingStartedAt ?? now))}</span>
        <kbd className="sk-kbd">{toggleListening.keys.join("")}</kbd>
      </>
    );
  } else {
    content = (
      <>
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        Start
        <kbd className="sk-kbd">{toggleListening.keys.join("")}</kbd>
      </>
    );
  }

  // One button with a fixed minimum width, so the bar never changes size between states. Stop with its
  // dots, timer and shortcut is the widest; Starting… and Stopping… fit inside the same width.
  return (
    <Tip
      label={isLive ? "Stop listening" : "Start listening"}
      keys={toggleListening.keys}
      disabled={isBusy}
    >
      <button
        type="button"
        className="sk-btn min-w-[184px] justify-center"
        disabled={isBusy}
        aria-label={isLive ? "Stop listening" : isBusy ? undefined : "Start listening"}
        onClick={() => (isLive ? stopMeeting() : startMeeting())}
      >
        <span key={meetingStatus} className="sk-fade inline-flex items-center gap-1.5">
          {content}
        </span>
      </button>
    </Tip>
  );
};

export const ControlBar: React.FC = () => {
  const setIsSettingsOpen = useSettingsStore((state) => state.setIsSettingsOpen);
  const setLayoutMode = useAppStore((state) => state.setLayoutMode);
  const setAskOpen = useAppStore((state) => state.setAskOpen);
  const hideWindow = useAppStore((state) => state.hideWindow);
  const isClickThrough = useAppStore((state) => state.isClickThrough);
  const showHide = getShortcut("show_hide");

  // Ask opens a typed question; live options are picked with Cmd+Option+1/2/3
  const handleAsk = () => {
    setIsSettingsOpen(false);
    if (useAppStore.getState().layoutMode === "dynamic_notch") {
      setLayoutMode("floating_hud");
    }
    setAskOpen(true);
    // Only this button asks for keyboard focus; the box opening on show leaves focus alone
    useAppStore.setState((s) => ({ askFocusRequest: s.askFocusRequest + 1 }));
  };

  return (
    <div
      role="toolbar"
      aria-label="Sidekick controls"
      data-tauri-drag-region
      className={cn("sk-bar relative", isClickThrough && "[--sk-surface-line:var(--sk-warn)]")}
    >
      <MeetingButton />
      <span className="sk-sep" aria-hidden="true" />
      <Tip label="Ask a question">
        <button type="button" className="sk-btn" onClick={handleAsk}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Ask
        </button>
      </Tip>
      <Tip label="Hide" keys={showHide.keys}>
        <button type="button" className="sk-btn" onClick={() => hideWindow()}>
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          Hide
          <kbd className="sk-kbd">{showHide.keys.join("")}</kbd>
        </button>
      </Tip>
      <span className="sk-sep" aria-hidden="true" />
      <BarMenu />
    </div>
  );
};
