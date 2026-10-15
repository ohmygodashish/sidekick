import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureActiveWindow } from "../lib/ipc";

describe("IPC Helper Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles captureActiveWindow fallback gracefully outside Tauri", async () => {
    const result = await captureActiveWindow();
    expect(result).toBeNull();
  });

  it("handles setSttEngine fallback gracefully outside Tauri", async () => {
    const { setSttEngine } = await import("../lib/ipc");
    const result = await setSttEngine("whisper_local");
    expect(result).toBeNull();
  });

  it("handles listLocalSttModels fallback gracefully outside Tauri", async () => {
    const { listLocalSttModels } = await import("../lib/ipc");
    const result = await listLocalSttModels();
    expect(result).toBeNull();
  });

  it("handles downloadSttModel fallback gracefully outside Tauri", async () => {
    const { downloadSttModel } = await import("../lib/ipc");
    const result = await downloadSttModel("tiny.en");
    expect(result).toBeNull();
  });
});
