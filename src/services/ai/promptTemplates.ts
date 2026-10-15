import { PersonalizationProfile, SeniorityPreset, TonePreset } from "../../store/settingsStore";

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

/**
 * Builds user prompt combining question, live pointers, transcript turns, and optional image context.
 */
export function buildUserPrompt(
  question: string,
  options?: {
    quickPointers?: string[];
    transcript?: string;
    hasImage?: boolean;
  }
): string {
  const parts: string[] = [];

  if (options?.hasImage) {
    parts.push(
      "A screenshot of the active coding problem / whiteboard window has been attached.",
      "Analyze both the screenshot and the question text."
    );
  }

  parts.push(`Question / Coding Task:\n"${question.trim()}"`);

  if (options?.quickPointers && options.quickPointers.length > 0) {
    parts.push(
      "Initial Talking Points / Clues:",
      options.quickPointers.map((p) => `- ${p}`).join("\n")
    );
  }

  if (options?.transcript?.trim()) {
    parts.push(`Recent Interviewer Speech Transcript:\n"${options.transcript.trim()}"`);
  }

  parts.push(
    "\nProvide the complete progressive solution formatted strictly with the stage tags."
  );

  return parts.join("\n\n");
}
