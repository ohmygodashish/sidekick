/**
 * Safely invokes a Tauri IPC command.
 * Gracefully falls back if running in browser/test environment.
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[Sidekick IPC] '${cmd}' failed or running outside Tauri context:`, err);
    }
    return null;
  }
}

/**
 * Invokes a Tauri command and rethrows its failure. A no-op outside Tauri (tests, browser), which returns undefined.
 */
export async function invokeInTauri<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  const { invoke, isTauri } = await import("@tauri-apps/api/core");
  if (typeof isTauri === "function" && isTauri()) return await invoke<T>(cmd, args);
  return undefined;
}

/**
 * Data payload returned by active-window vision capture (REQ-013, AC-003).
 */
export interface WindowCaptureResponse {
  base64_image: string;
  window_title?: string | null;
  app_name?: string | null;
  width: number;
  height: number;
}

/**
 * Commands the backend to silently capture the frontmost active application window.
 */
export async function captureActiveWindow(): Promise<WindowCaptureResponse | null> {
  return await safeInvoke<WindowCaptureResponse>("capture_active_window");
}

/**
 * Local Whisper model asset metadata.
 */
export interface ModelAssetInfo {
  name: string;
  filename: string;
  path?: string | null;
  size_bytes: number;
  is_available: boolean;
  download_url: string;
}

/**
 * Configures the active Speech-to-Text inference engine in the native backend.
 */
export async function setSttEngine(engine: string): Promise<string | null> {
  return await safeInvoke<string>("set_stt_engine", { engine });
}

/**
 * Lists available local STT model assets and their download/disk status.
 */
export async function listLocalSttModels(): Promise<ModelAssetInfo[] | null> {
  return await safeInvoke<ModelAssetInfo[]>("list_local_stt_models");
}

/**
 * Downloads a local STT model asset directly into Application Support.
 */
export async function downloadSttModel(modelName: string): Promise<string | null> {
  return await safeInvoke<string>("download_stt_model", { modelName });
}

/**
 * An audio input device. isDefault marks the one the system uses.
 */
export interface InputDevice {
  name: string;
  isDefault: boolean;
}

/**
 * Lists the microphones the system can record from.
 */
export async function listInputDevices(): Promise<InputDevice[] | null> {
  return await safeInvoke<InputDevice[]>("list_input_devices");
}

/**
 * Starts the microphone meter (no transcription). Rejects with a friendly message, e.g. when the mic is denied.
 */
export async function startMicTest(): Promise<void> {
  await invokeInTauri("start_mic_test");
}

/**
 * Stops the microphone meter.
 */
export async function stopMicTest(): Promise<void> {
  await safeInvoke("stop_mic_test");
}
