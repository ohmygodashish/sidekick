import React, { useEffect, useState } from "react";
import { EyeOff, LoaderCircle, Mic, Sparkles, Square } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { BarMenu } from "./BarMenu";
import { cn } from "../../lib/utils";

// m:ss under an hour, h:mm:ss after
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

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

  if (meetingStatus === "starting") {
    return (
      <button type="button" className="sk-btn" disabled>
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Starting…
      </button>
    );
  }

  if (meetingStatus === "stopping") {
    return (
      <button type="button" className="sk-btn" disabled>
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Stopping…
      </button>
    );
  }

  if (meetingStatus === "live") {
    return (
      <button
        type="button"
        className="sk-btn"
        aria-label="Stop meeting"
        onClick={() => stopMeeting()}
      >
        <Square className="h-3.5 w-3.5 fill-current text-red-400" aria-hidden="true" />
        Stop
        <span className="tabular-nums text-zinc-400">
          {formatElapsed(now - (meetingStartedAt ?? now))}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="sk-btn"
      aria-label="Start meeting"
      title="Start listening to the meeting"
      onClick={() => startMeeting()}
    >
      <Mic className="h-3.5 w-3.5" aria-hidden="true" />
      Start
    </button>
  );
};

export const ControlBar: React.FC = () => {
  const setIsSettingsOpen = useSettingsStore((state) => state.setIsSettingsOpen);
  const setLayoutMode = useAppStore((state) => state.setLayoutMode);
  const setAskOpen = useAppStore((state) => state.setAskOpen);
  const hideWindow = useAppStore((state) => state.hideWindow);
  const isClickThrough = useAppStore((state) => state.isClickThrough);

  const handleAsk = () => {
    setIsSettingsOpen(false);
    if (useAppStore.getState().layoutMode === "dynamic_notch") {
      setLayoutMode("floating_hud");
    }
    const question = useSessionStore.getState().activeQuestion;
    if (question) {
      window.dispatchEvent(new CustomEvent("sidekick:deep_solve", { detail: question }));
    } else {
      setAskOpen(true);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Sidekick controls"
      data-tauri-drag-region
      className={cn("sk-bar relative", isClickThrough && "ring-amber-400/70")}
    >
      <MeetingButton />
      <span className="sk-sep" aria-hidden="true" />
      <button type="button" className="sk-btn" onClick={handleAsk}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Ask
        <kbd className="sk-kbd">⌘↵</kbd>
      </button>
      <button type="button" className="sk-btn" onClick={() => hideWindow()}>
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        Hide
        <kbd className="sk-kbd">⌘⇧Space</kbd>
      </button>
      <span className="sk-sep" aria-hidden="true" />
      <BarMenu />
    </div>
  );
};
