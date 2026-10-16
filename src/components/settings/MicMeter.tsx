import React, { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

const SEGMENTS = 24;
const FLOOR_DB = -60;
const SEGMENT_DB = -FLOOR_DB / SEGMENTS; // 2.5 dB per segment
const FALL_DB_PER_S = 20; // the level falls this fast; it rises at once
const PEAK_HOLD_MS = 1000;
// Level events come about 30 a second; with none for this long the level falls rather than freezing
const SILENT_MS = 250;

interface MeterLevel {
  db: number;
  peakDb: number;
}

interface MeterView {
  db: number; // the displayed level, whole dB
  lit: number;
  peak: number; // index of the peak-hold segment, -1 for none
}

const IDLE: MeterView = { db: FLOOR_DB, lit: 0, peak: -1 };

/** Lit segments for a level: none at -60 dB, all at 0 dB. */
export function litSegments(db: number): number {
  if (!Number.isFinite(db)) return db > 0 ? SEGMENTS : 0;
  return Math.min(SEGMENTS, Math.max(0, Math.round((db - FLOOR_DB) / SEGMENT_DB)));
}

/** Green below -18 dB, amber up to -6 dB, red above. A segment takes the tone of its centre. */
function toneOf(index: number): string {
  const centre = FLOOR_DB + (index + 0.5) * SEGMENT_DB;
  if (centre < -18) return "bg-sk-success";
  if (centre < -6) return "bg-sk-warn";
  return "bg-sk-danger-solid";
}

/**
 * A monitoring-style level meter for the microphone test: 24 segments over -60 to 0 dB, a peak-hold
 * segment that stays for a second, and a fall of about 20 dB a second. It listens for the Rust level events
 * only while `active`. With reduced motion the level and peak jump without decay.
 */
export const MicMeter: React.FC<{ active: boolean }> = ({ active }) => {
  const [view, setView] = useState<MeterView>(IDLE);

  useEffect(() => {
    if (!active) {
      setView(IDLE);
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    // Events arrive about 30 a second; the frame loop reads the latest level and the highest peak since its last frame
    let targetDb = FLOOR_DB;
    let gotLevel = false;
    let pendingPeak = -Infinity;
    let silentMs = 0;
    let level = FLOOR_DB;
    let peak = -Infinity;
    let peakAt = 0;
    let last: number | null = null;
    let frame = 0;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const fall = reduceMotion ? Infinity : FALL_DB_PER_S * dt;
      silentMs = gotLevel ? 0 : silentMs + dt * 1000;
      gotLevel = false;

      const reading = silentMs > SILENT_MS ? FLOOR_DB : targetDb;
      level = Math.max(reading, level - fall);
      if (pendingPeak > -Infinity && pendingPeak >= peak) {
        peak = pendingPeak;
        peakAt = now;
      } else if (now - peakAt > PEAK_HOLD_MS) {
        peak -= fall;
      }
      pendingPeak = -Infinity;

      const db = Math.round(Math.max(level, FLOOR_DB));
      const lit = litSegments(level);
      const peakIndex = peak > -Infinity && litSegments(peak) > 0 ? litSegments(peak) - 1 : -1;
      setView((prev) =>
        prev.db === db && prev.lit === lit && prev.peak === peakIndex ? prev : { db, lit, peak: peakIndex }
      );
      frame = requestAnimationFrame(tick);
    };

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<MeterLevel>("sidekick://mic_test_level", (e) => {
          targetDb = e.payload.db;
          gotLevel = true;
          pendingPeak = Math.max(pendingPeak, e.payload.peakDb);
        })
      )
      .then((fn) => {
        // StrictMode and fast toggles can resolve the listener after cleanup
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    frame = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      unlisten?.();
    };
  }, [active]);

  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={view.db}
      className="flex h-3 w-full gap-0.5"
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-full min-w-0 flex-1 rounded-[2px]",
            i === view.peak ? "bg-sk-fg" : i < view.lit ? toneOf(i) : "bg-sk-fill-2"
          )}
        />
      ))}
    </div>
  );
};
