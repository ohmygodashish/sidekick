import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MicMeter, litSegments } from "../components/settings/MicMeter";

// Tauri events the meter listens to, plus an unlisten spy, so a test can play Rust
const tauri = vi.hoisted(() => ({
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (e: { payload: unknown }) => void) => {
    tauri.handlers.set(name, handler);
    return () => {
      tauri.handlers.delete(name);
      tauri.unlisten();
    };
  },
}));

// A frame queue the test drives, so decay and peak hold are exact
const frames = vi.hoisted(() => ({ queue: new Map<number, FrameRequestCallback>(), next: 1 }));
const runFrame = (now: number) => {
  const callbacks = [...frames.queue.values()];
  frames.queue.clear();
  for (const cb of callbacks) cb(now);
};

let reduceMotion = false;

const emit = (db: number, peakDb = db) =>
  act(() => {
    tauri.handlers.get("sidekick://mic_test_level")?.({ payload: { db, peakDb } });
  });

/** Advances the clock by `ms` in 16 ms frames, as the browser would. */
const advance = (ms: number, from: number) => {
  let now = from;
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    act(() => runFrame(now));
  }
  return now;
};

const segments = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[role="meter"] > span'));
const litCount = (container: HTMLElement) =>
  segments(container).filter((el) => /bg-sk-(success|warn|danger-solid)\b/.test(el.className)).length;
const peakIndex = (container: HTMLElement) => segments(container).findIndex((el) => el.className.includes("bg-sk-fg"));
const meterNow = () => Number(screen.getByRole("meter").getAttribute("aria-valuenow"));

describe("litSegments", () => {
  it("maps -60 dB to none and 0 dB to all 24 segments, linearly in between", () => {
    expect(litSegments(-60)).toBe(0);
    expect(litSegments(-100)).toBe(0);
    expect(litSegments(-30)).toBe(12);
    expect(litSegments(0)).toBe(24);
    expect(litSegments(6)).toBe(24);
  });
});

describe("MicMeter", () => {
  beforeEach(() => {
    frames.queue.clear();
    frames.next = 1;
    reduceMotion = false;
    tauri.handlers.clear();
    tauri.unlisten.mockClear();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = frames.next++;
      frames.queue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.queue.delete(id);
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduceMotion && query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is an accessible meter over -60 to 0 dB, empty when idle", () => {
    const { container } = render(<MicMeter active={false} />);
    const meter = screen.getByRole("meter", { name: "Microphone level" });

    expect(meter.getAttribute("aria-valuemin")).toBe("-60");
    expect(meter.getAttribute("aria-valuemax")).toBe("0");
    expect(meter.getAttribute("aria-valuenow")).toBe("-60");
    expect(segments(container)).toHaveLength(24);
    expect(litCount(container)).toBe(0);
  });

  it("lights segments from the level and colours them green, amber and red", async () => {
    const { container } = render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    // -6 dB lights 22 segments: 17 green, then amber up to -6 dB; the top one is the peak marker
    emit(-6, -6);
    advance(16, 0);

    expect(meterNow()).toBe(-6);
    expect(litCount(container)).toBe(21);
    expect(peakIndex(container)).toBe(21);
    const classes = segments(container).map((el) => el.className);
    expect(classes[0]).toContain("bg-sk-success");
    expect(classes[16]).toContain("bg-sk-success");
    expect(classes[17]).toContain("bg-sk-warn");
    expect(classes[20]).toContain("bg-sk-warn");
    expect(classes[22]).toContain("bg-sk-fill-2");

    // 0 dB lights everything; the top segments are red
    emit(0, 0);
    advance(16, 0);
    expect(segments(container)[22].className).toContain("bg-sk-danger-solid");
    expect(segments(container)[23].className).toContain("bg-sk-fg");
  });

  it("rises at once and falls about 20 dB a second", async () => {
    render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    emit(-10);
    let now = advance(16, 0);
    expect(meterNow()).toBe(-10);

    emit(-60);
    now = advance(500, now);
    expect(meterNow()).toBe(-20);
  });

  it("falls to the floor when level events stop, instead of freezing", async () => {
    render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    emit(-10);
    let now = advance(16, 0);
    expect(meterNow()).toBe(-10);

    // Silence: the level holds for a quarter second, then falls at the normal rate
    now = advance(1000, now);
    expect(meterNow()).toBeGreaterThan(-30);
    expect(meterNow()).toBeLessThan(-10);

    advance(3000, now);
    expect(meterNow()).toBe(-60);
  });

  it("holds the peak for a second, then lets the marker fall", async () => {
    const { container } = render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    emit(-60, -20);
    let now = advance(16, 0);
    expect(peakIndex(container)).toBe(15); // -20 dB is the 16th segment

    now = advance(900, now);
    expect(peakIndex(container)).toBe(15);

    now = advance(1000, now);
    expect(peakIndex(container)).toBeGreaterThanOrEqual(0);
    expect(peakIndex(container)).toBeLessThan(15);

    advance(3000, now);
    expect(peakIndex(container)).toBe(-1);
  });

  it("jumps straight to the level and drops the marker with reduced motion", async () => {
    reduceMotion = true;
    const { container } = render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    emit(-10);
    let now = advance(16, 0);
    emit(-60);
    now = advance(16, now);
    expect(meterNow()).toBe(-60);
    expect(litCount(container)).toBe(0);

    // The -10 dB peak holds for a second, then with reduced motion it goes at once
    now = advance(1100, now);
    expect(peakIndex(container)).toBe(-1);

    emit(-60, -20);
    now = advance(16, now);
    expect(peakIndex(container)).toBe(15);
    advance(1100, now);
    expect(peakIndex(container)).toBe(-1);
  });

  it("stops listening when the test ends, and when it unmounts", async () => {
    const { rerender, unmount } = render(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));

    rerender(<MicMeter active={false} />);
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
    expect(meterNow()).toBe(-60);

    rerender(<MicMeter active={true} />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(true));
    unmount();
    expect(tauri.unlisten).toHaveBeenCalledTimes(2);
    expect(frames.queue.size).toBe(0);
  });

  it("does nothing until the test is active", () => {
    render(<MicMeter active={false} />);
    expect(tauri.handlers.has("sidekick://mic_test_level")).toBe(false);
    expect(frames.queue.size).toBe(0);
    fireEvent.click(document.body);
  });
});
