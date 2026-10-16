import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildSystemPromptParts } from "../services/ai/promptTemplates";
import { PRESET_MODES, allModes, customModeInfo, resolveMode } from "../services/ai/modes";
import { parseProgressiveStream } from "../services/ai/streamParser";
import type { PersonalizationProfile } from "../store/settingsStore";

const profile: PersonalizationProfile = {
  resumeText: "Five years running Kafka pipelines at Uber.",
  jobDescription: "Staff Software Engineer, Real-Time Storage.",
  targetCompany: "Stripe",
  seniorityPreset: "staff",
  tonePreset: "staff",
};

const behavioral = resolveMode("behavioral", []).instructions;

describe("preset modes", () => {
  it("offers General, Behavioral, Coding and System Design, each with a one-line description", () => {
    expect(PRESET_MODES.map((m) => m.name)).toEqual(["General", "Behavioral", "Coding", "System Design"]);
    for (const mode of PRESET_MODES) {
      expect(mode.description).not.toMatch(/\n/);
      expect(mode.description.length).toBeGreaterThan(10);
    }
  });

  it("General adds no mode instructions: today's behaviour", () => {
    expect(resolveMode("general", []).instructions).toBeNull();
  });

  it("Behavioral asks for a STAR story in the summary and four talking points, with no code or complexity", () => {
    expect(behavioral).toContain("STAR");
    expect(behavioral).toContain("120 to 180 words");
    expect(behavioral).toContain("exactly four talking points");
    expect(behavioral).toContain("Leave out <stage_2_code> and <stage_3_analysis>");
    expect(behavioral).toContain("its own <tradeoff> element inside <key_tradeoffs>");
  });

  it("Behavioral parses to a summary and four talking points, one per <tradeoff> element", () => {
    // The shape the Behavioral instructions ask for
    const raw = [
      "<stage_1_intuition>",
      "<verbal_summary>",
      "At my last team our payments service timed out during a holiday sale. I was on call and owned the fix.",
      "I traced it to a connection pool that was too small, sized it from a load test and added an alert.",
      "Checkout errors dropped to zero that night, and the alert caught two similar issues since.",
      "</verbal_summary>",
      "<key_tradeoffs>",
      "<tradeoff>Situation: payments timed out during a holiday sale</tradeoff>",
      "<tradeoff>Task: I owned the fix as the on-call engineer</tradeoff>",
      "<tradeoff>Action: sized the pool from a load test and added an alert</tradeoff>",
      "<tradeoff>Result: checkout errors went to zero, and the alert caught two more issues</tradeoff>",
      "</key_tradeoffs>",
      "</stage_1_intuition>",
    ].join("\n");

    const solution = parseProgressiveStream(raw);

    expect(solution.stage1Intuition?.verbalSummary).toContain("payments service timed out");
    expect(solution.stage1Intuition?.keyTradeoffs).toEqual([
      "Situation: payments timed out during a holiday sale",
      "Task: I owned the fix as the on-call engineer",
      "Action: sized the pool from a load test and added an alert",
      "Result: checkout errors went to zero, and the alert caught two more issues",
    ]);
    expect(solution.stage2Code).toBeNull();
    expect(solution.stage3Analysis).toBeNull();
  });

  it("System Design parses its trade-offs and failure modes from their own elements", () => {
    const raw = [
      "<stage_1_intuition>",
      "<verbal_summary>Clients call a stateless API behind a load balancer; writes go to a queue and workers update the store.</verbal_summary>",
      "<key_tradeoffs>",
      "<tradeoff>Queue writes: faster responses, but reads can lag behind writes.</tradeoff>",
      "</key_tradeoffs>",
      "</stage_1_intuition>",
      "<stage_3_analysis>",
      "<time_complexity></time_complexity>",
      "<space_complexity></space_complexity>",
      "<edge_cases>",
      "<edge_case>Queue backlog grows past 10x load: shed low-priority writes and alert on lag.</edge_case>",
      "<edge_case>A worker crashes mid-write: retries are idempotent by request id.</edge_case>",
      "</edge_cases>",
      "</stage_3_analysis>",
    ].join("\n");

    const solution = parseProgressiveStream(raw);

    expect(solution.stage1Intuition?.keyTradeoffs).toHaveLength(1);
    expect(solution.stage3Analysis?.timeComplexity).toBe("");
    expect(solution.stage3Analysis?.edgeCases).toHaveLength(2);
  });

  it("System Design asks for requirements, components and trade-offs, with an optional code sketch", () => {
    const text = resolveMode("system_design", []).instructions ?? "";
    expect(text).toContain("requirements, components and trade-offs");
    expect(text).toContain("include only when a short API or schema sketch helps");
    expect(text).toContain("failure mode");
    expect(text).toContain("<tradeoff>");
    expect(text).toContain("<edge_case>");
  });

  it("falls back to General for an id that no longer exists", () => {
    expect(resolveMode("deleted_mode", [])).toEqual(PRESET_MODES[0]);
  });
});

describe("custom modes", () => {
  it("lists presets first, then custom modes, with the prompt as the instructions", () => {
    const custom = [{ id: "custom_1", name: "Pair programming", prompt: "  Think out loud.\n\nName the invariant.  " }];
    const all = allModes(custom);

    expect(all.map((m) => m.id)).toEqual(["general", "behavioral", "coding", "system_design", "custom_1"]);
    expect(resolveMode("custom_1", custom).instructions).toBe("Think out loud.\n\nName the invariant.");
    expect(resolveMode("custom_1", custom).description).toBe("Think out loud. Name the invariant.");
  });

  it("clips a long prompt to a single line for the description", () => {
    const info = customModeInfo({ id: "c", name: "Long", prompt: "word ".repeat(100) });
    expect(info.description.length).toBeLessThanOrEqual(160);
    expect(info.description).not.toMatch(/\s{2,}/);
  });
});

describe("buildSystemPrompt", () => {
  it("General in English is the plain prompt, with no MODE or LANGUAGE section", () => {
    const prompt = buildSystemPrompt(profile, { modeInstructions: null, outputLanguage: "English" });
    expect(prompt).not.toContain("### MODE");
    expect(prompt).not.toContain("### LANGUAGE");
    expect(prompt).toBe(buildSystemPrompt(profile));
  });

  it("puts the active mode's instructions after the stable prefix", () => {
    const { prefix, suffix } = buildSystemPromptParts(profile, { modeInstructions: behavioral });

    expect(suffix).toContain("### MODE");
    expect(suffix).toContain(behavioral!);
    expect(prefix + suffix).toBe(buildSystemPrompt(profile, { modeInstructions: behavioral }));
    expect(prefix).not.toContain("### MODE");
  });

  it("puts the output language after the mode", () => {
    const prompt = buildSystemPrompt(profile, { modeInstructions: behavioral, outputLanguage: "Hindi" });
    const modeAt = prompt.indexOf("### MODE");
    const languageAt = prompt.indexOf("### LANGUAGE");

    expect(modeAt).toBeGreaterThan(0);
    expect(languageAt).toBeGreaterThan(modeAt);
    expect(prompt.slice(languageAt)).toContain("Write every answer in Hindi.");
    expect(prompt.slice(languageAt)).toContain("Keep the XML tag names, code and identifiers in English.");
  });

  it("adds the language section without a mode, and leaves it out for English", () => {
    expect(buildSystemPrompt(profile, { outputLanguage: "Arabic" })).toContain("Write every answer in Arabic.");
    expect(buildSystemPrompt(profile, { outputLanguage: "English" })).not.toContain("### LANGUAGE");
  });

  it("keeps the prefix byte-identical across modes and languages for the same profile", () => {
    const base = buildSystemPromptParts(profile).prefix;
    const variants = [
      { modeInstructions: behavioral, outputLanguage: "Hindi" },
      { modeInstructions: resolveMode("coding", []).instructions, outputLanguage: "Japanese" },
      { modeInstructions: "Custom: be terse.", outputLanguage: "English" },
      {},
    ];
    for (const options of variants) {
      expect(buildSystemPromptParts(profile, options).prefix).toBe(base);
    }
  });

  it("changes the prefix when the profile changes", () => {
    const other = buildSystemPromptParts({ ...profile, targetCompany: "Datadog" }).prefix;
    expect(other).not.toBe(buildSystemPromptParts(profile).prefix);
  });
});
