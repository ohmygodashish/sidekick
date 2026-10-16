/** A custom mode as stored in settings: a name and the instructions the user wrote. */
export interface CustomMode {
  id: string;
  name: string;
  prompt: string;
}

/** A mode as the app uses it: a preset or a custom one. */
export interface ModeInfo {
  id: string;
  name: string;
  /** One line: shown in Settings and sent with the live-options request */
  description: string;
  /** Added to the system prompt after the stable prefix; null adds nothing (General) */
  instructions: string | null;
}

export const GENERAL_MODE_ID = "general";
export const CODING_MODE_ID = "coding";

const BEHAVIORAL_INSTRUCTIONS = [
  "This is a behavioral question. Answer with a STAR story the candidate tells out loud, in the first person.",
  "- verbal_summary: the full spoken answer, about 120 to 180 words. Weave in the Situation, Task, Action and Result without labels.",
  '- key_tradeoffs: exactly four talking points, one per beat. Put each in its own <tradeoff> element inside <key_tradeoffs>, starting with its beat name ("Situation: ...", "Task: ...", "Action: ...", "Result: ..."). Keep each short enough to glance at.',
  "- Output only <stage_1_intuition>. Leave out <stage_2_code> and <stage_3_analysis> entirely: no code and no complexity.",
].join("\n");

const CODING_INSTRUCTIONS = [
  "This is a coding task. Start the verbal summary with the approach and the data structure, in two to four sentences.",
  "Then give the code in stage 2 and the complexity in stage 3, as the format above describes.",
].join("\n");

const SYSTEM_DESIGN_INSTRUCTIONS = [
  "This is a system design question. Work through requirements, components and trade-offs.",
  "- verbal_summary: the architecture as the candidate says it, in four to six sentences: the scale and requirements first, then the main components and how a request flows between them.",
  "- key_tradeoffs: the main design decisions (for example consistency against availability, sync against async, where to cache), each with its pros and cons. Put each in its own <tradeoff> element inside <key_tradeoffs>.",
  "- stage_2_code: include only when a short API or schema sketch helps (JSON, SQL or HTTP). Otherwise leave out <stage_2_code>.",
  "- stage_3_analysis: leave time_complexity and space_complexity empty. Put each scaling limit and failure mode, and how it is handled, in its own <edge_case> element inside <edge_cases>.",
].join("\n");

export const PRESET_MODES: ModeInfo[] = [
  {
    id: GENERAL_MODE_ID,
    name: "General",
    description: "Answers any question: intuition, code when it helps, complexity.",
    instructions: null,
  },
  {
    id: "behavioral",
    name: "Behavioral",
    description: "STAR stories: a spoken first-person answer and four talking points.",
    instructions: BEHAVIORAL_INSTRUCTIONS,
  },
  {
    id: CODING_MODE_ID,
    name: "Coding",
    description: "Approach, then code, then complexity. The screen is on by default.",
    instructions: CODING_INSTRUCTIONS,
  },
  {
    id: "system_design",
    name: "System Design",
    description: "Requirements, components and trade-offs, with scaling limits.",
    instructions: SYSTEM_DESIGN_INSTRUCTIONS,
  },
];

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A custom mode in the shape the app uses: its prompt is the instructions, its start the description. */
export function customModeInfo(mode: CustomMode): ModeInfo {
  const prompt = mode.prompt.trim();
  return {
    id: mode.id,
    name: mode.name,
    description: oneLine(prompt).slice(0, 160),
    instructions: prompt || null,
  };
}

/** Presets first, then the user's custom modes. */
export function allModes(custom: CustomMode[]): ModeInfo[] {
  return [...PRESET_MODES, ...custom.map(customModeInfo)];
}

/** The mode with this id; an id that no longer exists (a deleted custom mode) falls back to General. */
export function resolveMode(id: string, custom: CustomMode[]): ModeInfo {
  return allModes(custom).find((m) => m.id === id) ?? PRESET_MODES[0];
}
