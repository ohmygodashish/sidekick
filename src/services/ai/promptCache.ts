// Tracks the system prompt prefixes the provider cache is believed to hold, one per request shape. Kept apart
// from the warm-up so the dispatcher can record real answers without importing the warm-up module.
import type { ReasoningMode } from "./openrouter";

/** Re-warm a little before the provider's 1-hour cache entry expires. */
const FRESH_MS = 55 * 60_000;

// Each request shape warmed or used recently, with the time it was last sent (one per thinking value)
const lastUsed = new Map<string, number>();

/**
 * Identifies a cached request shape: provider, model, the reasoning mode as sent (thinking is part of the cached
 * prompt; undefined means the model's default) and a hash of the prefix text.
 */
export function promptCacheFingerprint(
  provider: string,
  model: string,
  prefix: string,
  reasoning: ReasoningMode | undefined
): string {
  // FNV-1a: cheap, and a collision only costs one extra warm-up
  let hash = 0x811c9dc5;
  for (let i = 0; i < prefix.length; i++) {
    hash ^= prefix.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${provider}|${model}|${reasoning ?? "default"}|${(hash >>> 0).toString(36)}`;
}

/** Records that this request shape was just used or warmed, so it counts as cached for the next hour. */
export function markPromptCache(fingerprint: string): void {
  const now = Date.now();
  lastUsed.set(fingerprint, now);
  // Entries past the window are no longer worth keeping
  for (const [key, at] of lastUsed) if (now - at >= FRESH_MS) lastUsed.delete(key);
}

/** True when this request shape was used or warmed recently enough to still be cached. */
export function isPromptCacheWarm(fingerprint: string): boolean {
  const at = lastUsed.get(fingerprint);
  return at !== undefined && Date.now() - at < FRESH_MS;
}
