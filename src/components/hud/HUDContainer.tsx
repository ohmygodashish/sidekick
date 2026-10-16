import React, { useRef } from "react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useHitRegions } from "../../hooks/useHitRegions";
import { usePresence } from "../../hooks/usePresence";
import { ControlBar } from "./ControlBar";
import { CaptionLine } from "./CaptionLine";
import { LiveOptions } from "./LiveOptions";
import { AnswerPanel } from "../answer/AnswerPanel";
import { SettingsDrawer } from "../settings/SettingsDrawer";

/** A one-line pill under the bar that fades in and out with `show`. */
const StatusPill: React.FC<React.HTMLAttributes<HTMLParagraphElement> & { show: boolean }> = ({
  show,
  className,
  ...props
}) => {
  const presence = usePresence(show);
  if (!presence.mounted) return null;
  return (
    <p
      {...props}
      data-state={presence.state}
      inert={presence.state === "closed"}
      className={`sk-surface sk-pop rounded-full px-3 py-1.5 text-[12px] ${className ?? ""}`}
    />
  );
};

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
      <StatusPill show={isClickThrough} className="text-sk-warn">
        Click-through on · <kbd className="sk-kbd">⌘⇧C</kbd> to turn off
      </StatusPill>
      <StatusPill show={Boolean(meetingError)} role="alert" title={meetingError ?? undefined} className="text-sk-danger">
        {stopFailed
          ? "Couldn't stop listening. Try again, or press ⌘Esc to stop everything."
          : "Couldn't start listening. Check Microphone and Screen Recording access in System Settings."}
      </StatusPill>
      {layoutMode !== "dynamic_notch" && (
        <>
          <CaptionLine />
          <div className="w-full max-w-[560px]">
            <LiveOptions />
          </div>
        </>
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
