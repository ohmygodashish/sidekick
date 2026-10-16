import { PersonalizationProfile, SeniorityPreset, TonePreset } from "../../store/settingsStore";
import type { ProgressiveSolution } from "../../store/sessionStore";

/**
 * Returns tailored prompt guidance based on seniority preset (REQ-016).
 */
export function getSeniorityPrompt(seniority: SeniorityPreset = "senior"): string {
  switch (seniority) {
    case "junior":
      return "Seniority Level: Junior Engineer. Provide clear, step-by-step reasoning, fundamental data structures, well-commented clean code, and approachable explanations.";
    case "mid":
      return "Seniority Level: Mid-Level Engineer. Focus on clean idiomatic code, standard design patterns, comprehensive unit boundaries, and solid edge-case coverage.";
    case "senior":
      return "Seniority Level: Senior Engineer. Deliver highly optimized, production-grade solutions, emphasizing algorithmic trade-offs, defensive programming, and scalability.";
    case "staff":
      return "Seniority Level: Staff Engineer. Provide staff-level architectural insight: evaluate distributed systems trade-offs, operational reliability, failure modes, telemetry, and zero-downtime scaling.";
    case "principal":
      return "Seniority Level: Principal Architect. Emphasize multi-system architectural trade-offs, protocol invariants, consensus mechanisms, organizational velocity, and strategic long-term maintainability.";
    default:
      return "Seniority Level: Senior Engineer. Deliver production-ready, clean, optimal code with robust trade-off analysis.";
  }
}

/**
 * Returns tailored prompt guidance based on tone preset (REQ-016).
 */
export function getTonePrompt(tone: TonePreset = "balanced"): string {
  switch (tone) {
    case "concise":
      return "Tone Preset: Extremely Concise. Deliver maximum insight in minimal words. 2-3 sentences for intuition, minimal clean code, standard Big-O notation. No filler words.";
    case "balanced":
      return "Tone Preset: Balanced & Structured. Provide a confident, well-structured interview answer with clear intuition, idiomatic code, and practical complexity analysis.";
    case "deep":
      return "Tone Preset: Deep Technical Rigor. Provide in-depth algorithmic reasoning, mathematical proofs or invariants where helpful, and subtle boundary edge cases.";
    case "staff":
      return "Tone Preset: Staff Engineer. Speak like a senior tech lead: emphasize trade-offs, operational realities, fault tolerance, and elegant modular abstractions.";
    case "system_architect":
      return "Tone Preset: System Architect. Structure answers around high-level architecture, data models, APIs, throughput/latency limits, and failure domains.";
    default:
      return "Tone Preset: Balanced technical interview delivery.";
  }
}

/**
 * Builds the complete system prompt injecting candidate profile and formatting directives (REQ-014, REQ-015, REQ-016).
 */
export function buildSystemPrompt(profile?: Partial<PersonalizationProfile>): string {
  const seniorityText = getSeniorityPrompt(profile?.seniorityPreset);
  const toneText = getTonePrompt(profile?.tonePreset);

  const sections: string[] = [
    "You are Sidekick, a real-time technical interview copilot operating on macOS.",
    "Your objective is to help the candidate excel in technical coding and system design interviews by providing progressive, structured, production-ready solutions.",
    "",
    "### PERSONALIZATION DIRECTIVES",
    seniorityText,
    toneText,
  ];

  if (profile?.targetCompany?.trim()) {
    sections.push(`Target Company: ${profile.targetCompany.trim()}`);
    sections.push(
      "Tailor your terminology, architectural preferences, and design trade-offs to match the known engineering culture of this company."
    );
  }

  if (profile?.jobDescription?.trim()) {
    sections.push("Target Job Description & Role Context:");
    sections.push(profile.jobDescription.trim());
  }

  if (profile?.resumeText?.trim()) {
    sections.push("Candidate Background & Resume Context:");
    sections.push(profile.resumeText.trim());
    sections.push(
      "Subtly align terminology with the candidate's background to make the verbal explanation sound authentic and natural for them."
    );
  }

  sections.push(
    "",
    "### OUTPUT FORMAT RULES (CRITICAL FOR PROGRESSIVE STREAMING)",
    "You MUST structure your entire response using the following XML tag delimiters in order.",
    "This allows the UI to progressively render Stage 1 (Intuition), Stage 2 (Code), and Stage 3 (Complexity Analysis) in real time as tokens arrive.",
    "",
    "<stage_1_intuition>",
    "<verbal_summary>",
    "[2-4 sentences explaining the high-level intuition, algorithmic strategy, and data structure choice that the candidate can explain out loud to the interviewer]",
    "</verbal_summary>",
    "<key_tradeoffs>",
    "<tradeoff>[Key trade-off 1 with pros/cons]</tradeoff>",
    "<tradeoff>[Key trade-off 2 with pros/cons]</tradeoff>",
    "</key_tradeoffs>",
    "</stage_1_intuition>",
    "",
    "<stage_2_code>",
    "<language>[Programming language, e.g. python, typescript, go, java, c++, rust]</language>",
    "<code>",
    "[Clean, production-grade, syntax-valid code with concise helpful comments]",
    "</code>",
    "<explanation>",
    "[1-2 sentence explanation of the key implementation mechanic]",
    "</explanation>",
    "</stage_2_code>",
    "",
    "<stage_3_analysis>",
    "<time_complexity>[Time complexity in Big-O with explanation, e.g. O(N log N) where N is ...]</time_complexity>",
    "<space_complexity>[Space complexity in Big-O with explanation, e.g. O(1) auxiliary space]</space_complexity>",
    "<edge_cases>",
    "<edge_case>[Critical edge case 1 and how handled]</edge_case>",
    "<edge_case>[Critical edge case 2 and how handled]</edge_case>",
    "<edge_case>[Critical edge case 3 and how handled]</edge_case>",
    "</edge_cases>",
    "</stage_3_analysis>",
    "",
    "Do NOT output markdown code blocks wrapping the outer XML tags. Output the XML tags directly."
  );

  return sections.join("\n");
}

const MAX_HISTORY_EXCHANGES = 6;

/** The Assist request: the model sees the screen and the conversation and says what to do now. */
export const ASSIST_TASK =
  "Given the screen and the conversation, what should the candidate say or do right now?";
/** How an Assist answer is labelled in the thread. */
export const ASSIST_LABEL = "Help with what's on my screen";

export interface Exchange {
  question: string;
  answer: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Plain-text rendering of an answer for the follow-up history: summary, trade-offs, code,
 * complexity and edge cases, each capped so a long answer can't crowd out the new question.
 */
export function solutionToText(solution: ProgressiveSolution): string {
  const { stage1Intuition: s1, stage2Code: s2, stage3Analysis: s3 } = solution;
  const lines: string[] = [];
  if (s1?.verbalSummary) lines.push(clip(s1.verbalSummary, 600));
  if (s1?.keyTradeoffs.length) {
    lines.push("Trade-offs:", ...s1.keyTradeoffs.slice(0, 5).map((t) => `- ${clip(t, 200)}`));
  }
  if (s2?.code) lines.push(`Code (${s2.language || "text"}):`, clip(s2.code, 2000));
  if (s2?.explanation) lines.push(clip(s2.explanation, 300));
  if (s3?.timeComplexity || s3?.spaceComplexity) {
    lines.push(`Complexity: time ${s3.timeComplexity || "unknown"}, space ${s3.spaceComplexity || "unknown"}`);
  }
  if (s3?.edgeCases.length) lines.push("Edge cases:", ...s3.edgeCases.slice(0, 5).map((e) => `- ${clip(e, 200)}`));
  return lines.join("\n");
}

/**
 * Builds user prompt combining question, transcript turns, earlier exchanges of the thread
 * (follow-ups), and optional image context.
 */
export function buildUserPrompt(
  question: string,
  options?: {
    transcript?: string;
    hasImage?: boolean;
    history?: Exchange[];
  }
): string {
  const parts: string[] = [];

  if (options?.hasImage) {
    parts.push("A screenshot of the user's current screen (their active window) is attached. Use it together with the question.");
  }

  const history = options?.history?.slice(-MAX_HISTORY_EXCHANGES) ?? [];
  if (history.length > 0) {
    const exchanges = history
      .map((e) => `<exchange>\n<question>${e.question}</question>\n<answer>\n${e.answer}\n</answer>\n</exchange>`)
      .join("\n");
    parts.push(
      `<previous_exchanges>\n${exchanges}\n</previous_exchanges>`,
      "The question below is a follow-up to the previous exchanges above. Answer it in that context."
    );
  }

  parts.push(`Question / Coding Task:\n"${question.trim()}"`);

  if (options?.transcript?.trim()) {
    parts.push(`Recent conversation (speech-to-text):\n<transcript>\n${options.transcript.trim()}\n</transcript>`);
  }

  parts.push(
    "\nProvide the complete progressive solution formatted strictly with the stage tags."
  );

  return parts.join("\n\n");
}
