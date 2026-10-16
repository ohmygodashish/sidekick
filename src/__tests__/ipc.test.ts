import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureActiveWindow, invokeInTauri } from "../lib/ipc";

describe("IPC Helper Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles captureActiveWindow fallback gracefully outside Tauri", async () => {
    const result = await captureActiveWindow();
    expect(result).toBeNull();
  });

  it("invokeInTauri is a no-op outside Tauri", async () => {
    await expect(invokeInTauri("burn_session")).resolves.toBeUndefined();
  });

  it("invokeInTauri rethrows backend failures inside Tauri", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      invoke: vi.fn().mockRejectedValue(new Error("keychain locked")),
    }));
    const ipc = await import("../lib/ipc");

    await expect(ipc.invokeInTauri("store_api_key", { provider: "openai", key: "x" })).rejects.toThrow(
      "keychain locked"
    );
    vi.doUnmock("@tauri-apps/api/core");
    vi.resetModules();
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
