import { describe, it, expect } from "vitest";
import { activeModel, modelFor } from "../services/ai/models";

describe("answer models", () => {
  it("defaults each provider to its first listed model", () => {
    expect(modelFor("openrouter")).toBe("anthropic/claude-haiku-5.5");
    expect(modelFor("anthropic")).toBe("claude-haiku-5-5");
    expect(modelFor("openai")).toBe("gpt-6-luna");
  });

  it("keeps a listed model and replaces an unlisted one with the default", () => {
    expect(modelFor("openai", "gpt-6.1-sol")).toBe("gpt-6.1-sol");
    expect(modelFor("openai", "gpt-5.6-luna")).toBe("gpt-6-luna");
    expect(modelFor("openai")).toBe("gpt-6-luna");
  });

  it("answers with the active provider's remembered model, validated", () => {
    const selectedModels = { openrouter: "openai/gpt-6.1-sol", anthropic: "claude-opus-5-5", openai: "gpt-4o" };

    expect(activeModel({ selectedProvider: "openrouter", selectedModels })).toBe("openai/gpt-6.1-sol");
    expect(activeModel({ selectedProvider: "anthropic", selectedModels })).toBe("claude-opus-5-5");
    expect(activeModel({ selectedProvider: "openai", selectedModels })).toBe("gpt-6-luna");
  });
});
