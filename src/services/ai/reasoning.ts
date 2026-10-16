import type { ApiProvider } from "../../store/settingsStore";
import type { ReasoningMode } from "./openrouter";

/**
 * Which models take a thinking setting, and whether "none" (thinking off) can be sent to them. The request
 * builders, the prompt-cache fingerprint, the warm-up and the Settings switches all read these rules.
 */
export interface ReasoningSupport {
  /** The model takes a thinking setting at all; other models get no thinking fields */
  supported: boolean;
  /** "none" can be sent. False: the model always thinks, so "none" sends nothing and it uses its default */
  canDisable: boolean;
}

const NONE: ReasoningSupport = { supported: false, canDisable: false };

/** Claude models with an effort setting. Ids are free text in Settings, and OpenRouter writes 4.5 with a dot. */
const CLAUDE_EFFORT = /claude-(haiku-5|sonnet-5|opus-5|fable|mythos|sonnet-4[-.]6|opus-4[-.][5-8])/;
/** Claude models that reject thinking switched off */
const CLAUDE_ALWAYS_THINKS = /claude-(opus-5[-.]5|fable|mythos)/;
/** OpenRouter's Sonnet 5.5 has no "none" (direct Sonnet 5.5 turns thinking off with between_tools) */
const OPENROUTER_SONNET_55 = /claude-sonnet-5[-.]5/;
/** OpenAI reasoning models: GPT-5 and GPT-6 (not their chat variants, such as gpt-5-chat-latest), and the o-series. Groq's openai/gpt-oss-* ids match none of these. */
const OPENAI_REASONING = /^(gpt-5|gpt-6)(?!.*chat)|^o\d/i;
/** The OpenAI models that accept "none". GPT-5.0, GPT-6 Astra and GPT-6.1 Sol always reason. */
const OPENAI_CAN_DISABLE = /^(gpt-5\.6-|gpt-6-(sol|luna))/i;

function claudeSupport(id: string, viaOpenRouter: boolean): ReasoningSupport {
  if (!CLAUDE_EFFORT.test(id)) return NONE;
  const alwaysThinks = CLAUDE_ALWAYS_THINKS.test(id) || (viaOpenRouter && OPENROUTER_SONNET_55.test(id));
  return { supported: true, canDisable: !alwaysThinks };
}

function openAISupport(id: string): ReasoningSupport {
  if (!OPENAI_REASONING.test(id)) return NONE;
  return { supported: true, canDisable: OPENAI_CAN_DISABLE.test(id) };
}

/** Thinking support for a provider and model id. Groq and the other OpenRouter models are unsupported. */
export function reasoningSupport(provider: ApiProvider, model: string): ReasoningSupport {
  // OpenRouter and Groq ids carry a vendor prefix; the rules below read the bare model name
  const id = model.replace(/^(anthropic|openai)\//, "");
  if (provider === "anthropic") return claudeSupport(id, false);
  if (provider === "openai") return openAISupport(id);
  if (provider === "openrouter") {
    if (model.startsWith("anthropic/")) return claudeSupport(id, true);
    if (model.startsWith("openai/")) return openAISupport(id);
  }
  return NONE;
}

/**
 * The thinking value a request actually sends, or undefined when it sends no thinking fields and the model
 * uses its own default. Unsupported models get none. "none" on a model that always thinks gets none too, so
 * the request never fails on it.
 */
export function sentReasoning(
  provider: ApiProvider,
  model: string,
  reasoning: ReasoningMode | undefined
): ReasoningMode | undefined {
  if (!reasoning) return undefined;
  const { supported, canDisable } = reasoningSupport(provider, model);
  if (!supported) return undefined;
  if (reasoning === "none" && !canDisable) return undefined;
  return reasoning;
}

/** OpenAI's reasoning models, direct or as openai/ on OpenRouter. They take no temperature and need more output room. */
export function isOpenAIReasoningModel(model: string): boolean {
  return OPENAI_REASONING.test(model.replace(/^openai\//, ""));
}
