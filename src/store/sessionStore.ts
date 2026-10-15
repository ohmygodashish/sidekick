import { create } from "zustand";

export type Speaker = "interviewer" | "candidate";

export interface TranscriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: number;
}

export interface DetectedQuestion {
  questionId: string;
  timestamp: number;
  confidence: number;
  rawTranscript: string;
  extractedQuestion: string;
  quickPointers: string[];
}

export interface Stage1Intuition {
  verbalSummary: string;
  keyTradeoffs: string[];
}

export interface Stage2Code {
  language: string;
  code: string;
  explanation: string;
}

export interface Stage3Analysis {
  timeComplexity: string;
  spaceComplexity: string;
  edgeCases: string[];
}

export interface ProgressiveSolution {
  questionId?: string;
  provider?: string;
  model?: string;
  stage1Intuition: Stage1Intuition | null;
  stage2Code: Stage2Code | null;
  stage3Analysis: Stage3Analysis | null;
}

export interface SessionState {
  transcript: TranscriptTurn[];
  activeQuestion: DetectedQuestion | null;
  stage1Intuition: Stage1Intuition | null;
  stage2Code: Stage2Code | null;
  stage3Analysis: Stage3Analysis | null;
  activeSolutionProvider: string | null;
  activeSolutionModel: string | null;
  progressiveSolution: ProgressiveSolution | null;

  // Actions
  addTranscriptTurn: (turn: Omit<TranscriptTurn, "id"> & { id?: string }) => void;
  setActiveQuestion: (
    question:
      | DetectedQuestion
      | {
          question_id?: string;
          timestamp?: number;
          confidence?: number;
          raw_transcript?: string;
          extracted_question?: string;
          quick_pointers?: string[];
        }
      | null
  ) => void;
  setSolution: (
    solution:
      | ProgressiveSolution
      | {
          question_id?: string;
          provider?: string;
          model?: string;
          stage_1_intuition?: {
            verbal_summary?: string;
            key_tradeoffs?: string[];
          };
          stage_2_code?: {
            language?: string;
            code?: string;
            explanation?: string;
          };
          stage_3_analysis?: {
            time_complexity?: string;
            space_complexity?: string;
            edge_cases?: string[];
          };
        }
      | null
  ) => void;
  setStage1Intuition: (stage: Stage1Intuition | null) => void;
  setStage2Code: (stage: Stage2Code | null) => void;
  setStage3Analysis: (stage: Stage3Analysis | null) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  transcript: [],
  activeQuestion: null,
  stage1Intuition: null,
  stage2Code: null,
  stage3Analysis: null,
  activeSolutionProvider: null,
  activeSolutionModel: null,
  progressiveSolution: null,

  addTranscriptTurn: (turn) => {
    const id =
      turn.id || `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    set((state) => ({
      transcript: [...state.transcript, { ...turn, id }],
    }));
  },

  setActiveQuestion: (raw) => {
    if (!raw) {
      set({ activeQuestion: null });
      return;
    }

    // Support both camelCase and snake_case backend payloads
    const questionId =
      "questionId" in raw
        ? raw.questionId
        : "question_id" in raw && raw.question_id
          ? raw.question_id
          : `q_${Date.now()}`;
    const timestamp = raw.timestamp ?? Date.now();
    const confidence = raw.confidence ?? 1.0;
    const rawTranscript =
      "rawTranscript" in raw
        ? raw.rawTranscript
        : "raw_transcript" in raw && raw.raw_transcript
          ? raw.raw_transcript
          : "";
    const extractedQuestion =
      "extractedQuestion" in raw
        ? raw.extractedQuestion
        : "extracted_question" in raw && raw.extracted_question
          ? raw.extracted_question
          : "";
    const quickPointers =
      "quickPointers" in raw
        ? raw.quickPointers
        : "quick_pointers" in raw && Array.isArray(raw.quick_pointers)
          ? raw.quick_pointers
          : [];

    set({
      activeQuestion: {
        questionId,
        timestamp,
        confidence,
        rawTranscript,
        extractedQuestion,
        quickPointers,
      },
    });
  },

  setSolution: (raw) => {
    if (!raw) {
      set({
        stage1Intuition: null,
        stage2Code: null,
        stage3Analysis: null,
        activeSolutionProvider: null,
        activeSolutionModel: null,
        progressiveSolution: null,
      });
      return;
    }

    // Parse Stage 1
    let stage1: Stage1Intuition | null = null;
    if ("stage1Intuition" in raw && raw.stage1Intuition) {
      stage1 = raw.stage1Intuition;
    } else if ("stage_1_intuition" in raw && raw.stage_1_intuition) {
      const s1 = raw.stage_1_intuition;
      stage1 = {
        verbalSummary: s1.verbal_summary ?? "",
        keyTradeoffs: Array.isArray(s1.key_tradeoffs) ? s1.key_tradeoffs : [],
      };
    }

    // Parse Stage 2
    let stage2: Stage2Code | null = null;
    if ("stage2Code" in raw && raw.stage2Code) {
      stage2 = raw.stage2Code;
    } else if ("stage_2_code" in raw && raw.stage_2_code) {
      const s2 = raw.stage_2_code;
      stage2 = {
        language: s2.language ?? "python",
        code: s2.code ?? "",
        explanation: s2.explanation ?? "",
      };
    }

    // Parse Stage 3
    let stage3: Stage3Analysis | null = null;
    if ("stage3Analysis" in raw && raw.stage3Analysis) {
      stage3 = raw.stage3Analysis;
    } else if ("stage_3_analysis" in raw && raw.stage_3_analysis) {
      const s3 = raw.stage_3_analysis;
      stage3 = {
        timeComplexity: s3.time_complexity ?? "",
        spaceComplexity: s3.space_complexity ?? "",
        edgeCases: Array.isArray(s3.edge_cases) ? s3.edge_cases : [],
      };
    }

    const questionId =
      "questionId" in raw
        ? raw.questionId
        : "question_id" in raw
          ? raw.question_id
          : undefined;

    const progressiveSolution: ProgressiveSolution = {
      questionId,
      provider: raw.provider ?? undefined,
      model: raw.model ?? undefined,
      stage1Intuition: stage1,
      stage2Code: stage2,
      stage3Analysis: stage3,
    };

    set({
      stage1Intuition: stage1,
      stage2Code: stage2,
      stage3Analysis: stage3,
      activeSolutionProvider: raw.provider ?? null,
      activeSolutionModel: raw.model ?? null,
      progressiveSolution,
    });
  },

  setStage1Intuition: (stage) =>
    set((state) => {
      const progressiveSolution: ProgressiveSolution = {
        questionId: state.activeQuestion?.questionId,
        provider: state.activeSolutionProvider ?? undefined,
        model: state.activeSolutionModel ?? undefined,
        stage1Intuition: stage,
        stage2Code: state.stage2Code,
        stage3Analysis: state.stage3Analysis,
      };
      return { stage1Intuition: stage, progressiveSolution };
    }),

  setStage2Code: (stage) =>
    set((state) => {
      const progressiveSolution: ProgressiveSolution = {
        questionId: state.activeQuestion?.questionId,
        provider: state.activeSolutionProvider ?? undefined,
        model: state.activeSolutionModel ?? undefined,
        stage1Intuition: state.stage1Intuition,
        stage2Code: stage,
        stage3Analysis: state.stage3Analysis,
      };
      return { stage2Code: stage, progressiveSolution };
    }),

  setStage3Analysis: (stage) =>
    set((state) => {
      const progressiveSolution: ProgressiveSolution = {
        questionId: state.activeQuestion?.questionId,
        provider: state.activeSolutionProvider ?? undefined,
        model: state.activeSolutionModel ?? undefined,
        stage1Intuition: state.stage1Intuition,
        stage2Code: state.stage2Code,
        stage3Analysis: stage,
      };
      return { stage3Analysis: stage, progressiveSolution };
    }),

  clearSession: () =>
    set({
      transcript: [],
      activeQuestion: null,
      stage1Intuition: null,
      stage2Code: null,
      stage3Analysis: null,
      activeSolutionProvider: null,
      activeSolutionModel: null,
      progressiveSolution: null,
    }),
}));
