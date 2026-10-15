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

