import React from "react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore, Speaker, TranscriptTurn } from "../../store/sessionStore";

// Captions read best from the end, so long turns keep their tail
const MAX_CHARS = 120;

// Each source's label matches its level dot in the bar
const SOURCES: { speaker: Speaker; label: string; tone: string }[] = [
  { speaker: "interviewer", label: "System", tone: "text-sky-300" },
  { speaker: "candidate", label: "Microphone", tone: "text-orange-300" },
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
  if (!isLive) return null;

  const turns = { interviewer: system, candidate: mic };

  return (
    <div
      data-testid="caption-line"
      aria-live="polite"
      className="sk-surface w-full max-w-[560px] rounded-xl px-3 py-1.5 text-[12px] leading-5 text-zinc-200"
    >
      {SOURCES.map(({ speaker, label, tone }) => {
        const text = turns[speaker]?.text;
        return (
          <p key={speaker} className="truncate">
            <span className={tone}>{label}</span>
            <span className="text-zinc-500"> · </span>
            {text ? (
              text.length > MAX_CHARS ? `…${text.slice(-MAX_CHARS)}` : text
            ) : (
              <span className="text-zinc-500">Listening…</span>
            )}
          </p>
        );
      })}
      {sttError && (
        <p role="status" className={`truncate ${sttError.recovered ? "text-amber-300" : "text-red-300"}`}>
          {sttError.message}
        </p>
      )}
    </div>
  );
};
