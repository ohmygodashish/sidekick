import { describe, it, expect } from "vitest";
import { isOpenAIReasoningModel, reasoningSupport, sentReasoning } from "../services/ai/reasoning";
import type { ReasoningMode } from "../services/ai/openrouter";
import type { ApiProvider } from "../store/settingsStore";

describe("reasoningSupport", () => {
  it.each<[ApiProvider, string, boolean, boolean]>([
    // [provider, model, supported, canDisable]
    ["anthropic", "claude-haiku-5-5", true, true],
    ["anthropic", "claude-sonnet-5", true, true],
    // Sonnet 5.5 always thinks, on every provider
    ["anthropic", "claude-sonnet-5-5", true, false],
    ["anthropic", "claude-sonnet-5.5", true, false],
    ["anthropic", "claude-opus-5", true, true],
    ["anthropic", "claude-opus-5-5", true, false],
    ["anthropic", "claude-fable-1", true, false],
    ["anthropic", "claude-mythos-1", true, false],
    ["anthropic", "claude-sonnet-4-6", true, true],
    ["anthropic", "claude-opus-4-5", true, true],
    ["anthropic", "anthropic/claude-haiku-5-5", true, true],
    ["anthropic", "claude-opus-4-4", false, false],
    ["anthropic", "claude-3-5-sonnet-20241022", false, false],
    ["anthropic", "gpt-4o", false, false],
    ["openai", "gpt-5.6-luna", true, true],
    ["openai", "gpt-5.6-terra", true, true],
    ["openai", "gpt-5.6-sol", true, true],
    ["openai", "gpt-6-sol", true, true],
    ["openai", "gpt-6-luna", true, true],
    ["openai", "gpt-6-astra", true, false],
    ["openai", "gpt-6.1-sol", true, false],
    ["openai", "gpt-5", true, false],
    ["openai", "gpt-5-mini", true, false],
    ["openai", "gpt-5-nano", true, false],
    ["openai", "o3", true, false],
    ["openai", "openai/gpt-5.6-luna", true, true],
    ["openai", "gpt-4o", false, false],
    ["openai", "gpt-4.1", false, false],
    // Chat variants are not reasoning models
    ["openai", "gpt-5-chat-latest", false, false],
    ["openrouter", "openai/gpt-5-chat-latest", false, false],
    ["openrouter", "anthropic/claude-haiku-5.5", true, true],
    ["openrouter", "anthropic/claude-sonnet-5", true, true],
    ["openrouter", "anthropic/claude-opus-5", true, true],
    ["openrouter", "anthropic/claude-opus-4.6", true, true],
    ["openrouter", "anthropic/claude-opus-5.5", true, false],
    ["openrouter", "anthropic/claude-fable-5", true, false],
    ["openrouter", "anthropic/claude-fable-5.1", true, false],
    ["openrouter", "anthropic/claude-sonnet-5.5", true, false],
    ["openrouter", "openai/gpt-5.6-luna", true, true],
    ["openrouter", "openai/gpt-6-astra", true, false],
    ["openrouter", "openai/gpt-6.1-sol", true, false],
    ["openrouter", "openai/gpt-oss-120b", false, false],
    ["openrouter", "google/gemini-3.8-flash", false, false],
    ["openrouter", "qwen/qwen3.8-27b", false, false],
    ["groq", "openai/gpt-oss-120b", false, false],
    ["groq", "qwen/qwen3.8-27b", false, false],
  ])("%s %s: supported %s, can disable %s", (provider, model, supported, canDisable) => {
    expect(reasoningSupport(provider, model)).toEqual({ supported, canDisable });
  });
});

describe("sentReasoning", () => {
  // [provider, model, asked, sent]: undefined means no thinking fields, so the model uses its default
  it.each<[ApiProvider, string, ReasoningMode | undefined, ReasoningMode | undefined]>([
    ["anthropic", "claude-haiku-5-5", "none", "none"],
    ["anthropic", "claude-haiku-5-5", undefined, undefined],
    ["anthropic", "claude-opus-5-5", "none", undefined],
    ["anthropic", "claude-opus-5-5", "low", "low"],
    ["anthropic", "claude-3-5-sonnet-20241022", "high", undefined],
    ["openai", "gpt-6-astra", "none", undefined],
    ["openai", "gpt-6-astra", "medium", "medium"],
    ["openai", "gpt-5.6-luna", "none", "none"],
    ["openai", "gpt-4o", "high", undefined],
    ["openrouter", "anthropic/claude-haiku-5.5", "none", "none"],
    ["openrouter", "anthropic/claude-sonnet-5.5", "none", undefined],
    ["openrouter", "anthropic/claude-sonnet-5.5", "high", "high"],
    ["openrouter", "openai/gpt-6.1-sol", "none", undefined],
    ["openrouter", "google/gemini-3.8-flash", "high", undefined],
    ["groq", "openai/gpt-oss-120b", "high", undefined],
  ])("%s %s asked %s sends %s", (provider, model, asked, sent) => {
    expect(sentReasoning(provider, model, asked)).toBe(sent);
  });
});

describe("isOpenAIReasoningModel", () => {
  it.each<[string, boolean]>([
    ["gpt-5.6-luna", true],
    ["gpt-6-sol", true],
    ["o4-mini", true],
    ["openai/gpt-6-astra", true],
    ["openai/gpt-oss-120b", false],
    ["gpt-5-chat-latest", false],
    ["gpt-4o", false],
    ["anthropic/claude-haiku-5.5", false],
  ])("%s is a reasoning model: %s", (model, expected) => {
    expect(isOpenAIReasoningModel(model)).toBe(expected);
  });
});
