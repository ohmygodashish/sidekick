import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  captureActiveWindow,
  storeApiKey,
  retrieveApiKey,
  burnSession,
} from "../lib/ipc";

describe("IPC Helper Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles captureActiveWindow fallback gracefully outside Tauri", async () => {
    const result = await captureActiveWindow();
    expect(result).toBeNull();
  });

  it("handles storeApiKey fallback gracefully outside Tauri", async () => {
    const result = await storeApiKey("openai", "sk-test");
    expect(result).toBe(false);
  });

  it("handles retrieveApiKey fallback gracefully outside Tauri", async () => {
    const result = await retrieveApiKey("openai");
    expect(result).toBeNull();
  });

  it("handles burnSession fallback gracefully outside Tauri", async () => {
    const result = await burnSession();
    expect(result).toBe(false);
  });

  it("handles startAudioCapture fallback gracefully outside Tauri", async () => {
    const { startAudioCapture } = await import("../lib/ipc");
    const result = await startAudioCapture({
      capture_interviewer: true,
      capture_candidate: true,
    });
    expect(result).toBe(false);
  });

  it("handles stopAudioCapture fallback gracefully outside Tauri", async () => {
    const { stopAudioCapture } = await import("../lib/ipc");
    const result = await stopAudioCapture();
    expect(result).toBe(false);
  });

  it("handles getAudioCaptureState fallback gracefully outside Tauri", async () => {
    const { getAudioCaptureState } = await import("../lib/ipc");
    const result = await getAudioCaptureState();
    expect(result).toBeNull();
  });
});
