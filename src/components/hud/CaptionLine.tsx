import React from "react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore, Speaker, TranscriptTurn } from "../../store/sessionStore";
import { usePresence } from "../../hooks/usePresence";

// Captions read best from the end, so long turns keep their tail
const MAX_CHARS = 120;

// Each source's label matches its level dot in the bar
const SOURCES: { speaker: Speaker; label: string; tone: string }[] = [
  { speaker: "interviewer", label: "System", tone: "text-sk-system" },
  { speaker: "candidate", label: "Microphone", tone: "text-sk-mic" },
];

const latestFrom = (transcript: TranscriptTurn[], speaker: Speaker) => {
  for (let i = transcript.length - 1; i >= 0; i--) if (transcript[i].speaker === speaker) return transcript[i];
  return undefined;
};

/** While listening: the latest sentence from system audio and from the mic, one line each. */
export const CaptionLine: React.FC = () => {
  const isLive = useAppStore((s) => s.meetingStatus === "live");
  const sttError = useAppStore((s) => s.sttError);
  const system = useSessionStore((s) => latestFrom(s.transcript, "interviewer"));
  const mic = useSessionStore((s) => latestFrom(s.transcript, "candidate"));
  const presence = usePresence(isLive);
  if (!presence.mounted) return null;

  const turns = { interviewer: system, candidate: mic };

  return (
    <div
      data-testid="caption-line"
      aria-live="polite"
      data-state={presence.state}
      inert={presence.state === "closed"}
      className="sk-surface sk-pop w-full max-w-[560px] rounded-xl px-3 py-1.5 text-[12px] leading-5 text-sk-fg-2"
    >
      {SOURCES.map(({ speaker, label, tone }) => {
        const turn = turns[speaker];
        return (
          <p key={speaker} className="truncate">
            <span className={tone}>{label}</span>
            <span className="text-sk-fg-4"> · </span>
            {turn ? (
              // Keyed by turn so each new sentence fades in
              <span key={turn.id} className="sk-fade">
                {turn.text.length > MAX_CHARS ? `…${turn.text.slice(-MAX_CHARS)}` : turn.text}
              </span>
            ) : (
              <span className="text-sk-fg-4">Listening…</span>
            )}
          </p>
        );
      })}
      {sttError && (
        <p role="status" className={`sk-fade truncate ${sttError.recovered ? "text-sk-warn" : "text-sk-danger"}`}>
          {sttError.message}
        </p>
      )}
    </div>
  );
};
