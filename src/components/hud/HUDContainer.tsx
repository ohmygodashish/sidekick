import React from "react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ControlBar } from "./ControlBar";
import { AnswerPanel } from "../answer/AnswerPanel";
import { SettingsDrawer } from "../settings/SettingsDrawer";

export const HUDContainer: React.FC = () => {
  const layoutMode = useAppStore((state) => state.layoutMode);
  const meetingError = useAppStore((state) => state.meetingError);
  // stopMeeting keeps the status "live" when stopping fails
  const stopFailed = useAppStore((state) => state.meetingStatus === "live");
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);

  return (
    <div className="flex h-full w-full flex-col items-center gap-2 px-4 pb-4 pt-2">
      <ControlBar />
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
