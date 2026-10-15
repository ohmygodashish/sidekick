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
 * Safely emits a Tauri event.
 * Gracefully falls back if running in browser/test environment.
 */
export async function safeEmit<T>(event: string, payload?: T): Promise<boolean> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(event, payload);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[Sidekick IPC] '${event}' emit failed or running outside Tauri context:`, err);
    }
    return false;
  }
}

/**
 * Stores an API key into secure Keychain storage via Tauri backend.
 */
export async function storeApiKey(provider: string, key: string): Promise<boolean> {
  const result = await safeInvoke<boolean | null>("store_api_key", { provider, key });
  return result !== null;
}

/**
 * Retrieves an API key from secure Keychain storage via Tauri backend.
 */
export async function retrieveApiKey(provider: string): Promise<string | null> {
  return await safeInvoke<string>("retrieve_api_key", { provider });
}

/**
 * Commands the backend to purge live audio buffers, session state, and cached context.
 */
export async function burnSession(): Promise<boolean> {
  const result = await safeInvoke<boolean | null>("burn_session");
  return result !== null;
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
 * Speaker diarization channel identifiers (REQ-008).
 */
export type Channel = "interviewer" | "candidate";

/**
 * Speech turn audio chunk contract emitted by mixer.
 */
export interface AudioChunk {
  channel: Channel;
  samples: number[];
  sample_rate: number;
  timestamp_ms: number;
  duration_secs: number;
  rms_energy: number;
  is_speech: boolean;
}

/**
 * Configuration options for starting dual-channel audio capture (REQ-007, REQ-008).
 */
export interface AudioCaptureConfig {
  capture_interviewer: boolean;
  capture_candidate: boolean;
  vad_silence_secs?: number;
  vad_threshold?: number;
}

/**
 * State snapshot of the native audio capture pipeline.
 */
export interface AudioStateSnapshot {
  is_capturing: boolean;
  is_interviewer_capturing: boolean;
  is_candidate_capturing: boolean;
  is_panicked: boolean;
}

/**
 * Starts audio capture on ScreenCaptureKit system sound and/or microphone.
 */
export async function startAudioCapture(config?: AudioCaptureConfig): Promise<boolean> {
  const result = await safeInvoke<boolean | null>("start_audio_capture", { config });
  return result !== null;
}

/**
 * Halts active audio capture streams.
 */
export async function stopAudioCapture(): Promise<boolean> {
  const result = await safeInvoke<boolean | null>("stop_audio_capture");
  return result !== null;
}

/**
 * Retrieves the current atomic snapshot of the audio capture pipeline.
 */
export async function getAudioCaptureState(): Promise<AudioStateSnapshot | null> {
  return await safeInvoke<AudioStateSnapshot>("get_audio_capture_state");
}

/**
 * Standardized Speech-to-Text transcript chunk delivered via sidekick://stt_chunk (REQ-009, REQ-010).
 */
export interface SttChunk {
  id: string;
  speaker: Channel;
  text: string;
  timestamp: number;
  is_final: boolean;
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
 * Retrieves the currently active Speech-to-Text engine identifier.
 */
export async function getSttEngine(): Promise<string | null> {
  return await safeInvoke<string>("get_stt_engine");
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

