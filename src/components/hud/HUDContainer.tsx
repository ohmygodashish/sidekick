import React, { useRef } from "react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useHitRegions } from "../../hooks/useHitRegions";
import { ControlBar } from "./ControlBar";
import { AnswerPanel } from "../answer/AnswerPanel";
import { SettingsDrawer } from "../settings/SettingsDrawer";

export const HUDContainer: React.FC = () => {
  const layoutMode = useAppStore((state) => state.layoutMode);
  const meetingError = useAppStore((state) => state.meetingError);
  // stopMeeting keeps the status "live" when stopping fails
  const stopFailed = useAppStore((state) => state.meetingStatus === "live");
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);
  const isClickThrough = useAppStore((state) => state.isClickThrough);
  const rootRef = useRef<HTMLDivElement>(null);
  useHitRegions(rootRef);

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full flex-col items-center gap-2 p-2"
    >
      <ControlBar />
      {isClickThrough && (
        <p className="sk-surface rounded-full px-3 py-1.5 text-[12px] text-amber-300">
          Click-through on · <kbd className="sk-kbd">⌘⇧C</kbd> to turn off
        </p>
      )}
      {meetingError && (
        <p
          role="alert"
          title={meetingError}
          className="sk-surface rounded-full px-3 py-1.5 text-[12px] text-red-300"
        >
          {stopFailed
            ? "Couldn't stop listening. Try again, or press ⌘Esc to stop everything."
            : "Couldn't start listening. Check Microphone and Screen Recording access in System Settings."}
        </p>
      )}
      <div className="flex min-h-0 w-full max-w-[560px] flex-1 flex-col">
        {isSettingsOpen ? (
          <SettingsDrawer />
        ) : layoutMode === "dynamic_notch" ? null : (
          <AnswerPanel />
        )}
      </div>
    </div>
  );
};
