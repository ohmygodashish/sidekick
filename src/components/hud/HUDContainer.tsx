import React, { useRef } from "react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useHitRegions } from "../../hooks/useHitRegions";
import { usePresence } from "../../hooks/usePresence";
import { cn } from "../../lib/utils";
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
      className={cn("sk-surface sk-pop rounded-full px-3 py-1.5 text-[12px]", className)}
    />
  );
};

export const HUDContainer: React.FC = () => {
  const layoutMode = useAppStore((state) => state.layoutMode);
  const meetingError = useAppStore((state) => state.meetingError);
  // The pill fades out after the error clears, so it keeps the last message while fading
  const lastMeetingError = useRef<string | null>(null);
  if (meetingError) lastMeetingError.current = meetingError;
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
      <StatusPill show={Boolean(meetingError)} role="alert" className="max-w-[560px] rounded-2xl text-center text-sk-danger">
        {lastMeetingError.current}
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
