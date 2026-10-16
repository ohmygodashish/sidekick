import { create } from "zustand";

export type Speaker = "interviewer" | "candidate";

export interface TranscriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: number;
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

/** typed: Ask box · option: a live option picked · assist: ⌘↵ */
export type MessageKind = "typed" | "option" | "assist";

export interface ThreadMessage {
  id: string;
  question: string;
  kind: MessageKind;
  viewedScreen: boolean; // a screenshot was attached to this answer
  solution: ProgressiveSolution | null;
  error: string | null;
}

/** One chat: a first question and the follow-ups that continue it. */
export interface Thread {
  id: string;
  startedAt: number;
  messages: ThreadMessage[]; // oldest first
}

export type MessagePatch = Partial<Pick<ThreadMessage, "viewedScreen" | "solution" | "error">>;

export interface BegunMessage {
  threadId: string;
  messageId: string;
  /** Messages in the same thread before this one (the follow-up context) */
  before: ThreadMessage[];
}

export interface SolveRequest {
  question: string;
  kind?: MessageKind; // default "typed"
  newThread?: boolean; // default false: continue the active thread
  captureWindow?: boolean; // default true
  retryMessageId?: string; // rerun that message in place
}

export const STOPPED_MESSAGE = "Stopped before it finished.";

/** Asks the solver (useDeepSolver) for an answer; it adds the message and streams the answer into it. */
export function requestSolve(request: SolveRequest): void {
  window.dispatchEvent(new CustomEvent("sidekick:deep_solve", { detail: request }));
}

export const activeThreadOf = (s: Pick<SessionState, "threads" | "activeThreadId">): Thread | null =>
  s.threads.find((t) => t.id === s.activeThreadId) ?? null;

export interface SessionState {
  transcript: TranscriptTurn[];

  // This meeting only, in memory: newest thread first. The panel shows the active one.
  threads: Thread[];
  activeThreadId: string | null;
  solvingMessageId: string | null; // the message being streamed, if any

  // Live options: the asked question stays pinned until the next one is asked
  askedQuestion: string | null;
  likelyQuestions: string[];
  pickedOption: string | null;
  optionsError: string | null;

  // Screen toggles and the Ask draft, session only
  askDraft: string;
  askUsesScreen: boolean;
  optionsUseScreen: boolean;

  // Actions
  addTranscriptTurn: (turn: Omit<TranscriptTurn, "id"> & { id?: string }) => void;
  /** Adds a message to the active thread (or to a new one), or resets a failed message for a retry */
  beginMessage: (input: {
    question: string;
    kind: MessageKind;
    newThread: boolean;
    retryMessageId?: string;
  }) => BegunMessage | null;
  updateMessage: (threadId: string, messageId: string, patch: MessagePatch) => void;
  /** A solve was aborted: an unanswered message is removed, a partial answer says it stopped */
  stopMessage: (threadId: string, messageId: string) => void;
  openThread: (threadId: string) => void;
  // Ends the answer on screen (cancels a running solve) and ends the active thread; it stays in history
  clearAnswer: () => void;
  // Ends every thread: Stop, panic, Burn
  clearThreads: () => void;
  clearSession: () => void;
}

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

const cancelSolve = () => window.dispatchEvent(new Event("sidekick:cancel_solve"));

const hasAnswer = (solution: ProgressiveSolution | null) =>
  Boolean(solution && (solution.stage1Intuition || solution.stage2Code || solution.stage3Analysis));

const mapMessage = (
  threads: Thread[],
  threadId: string,
  messageId: string,
  change: (m: ThreadMessage) => ThreadMessage
): Thread[] =>
  threads.map((t) =>
    t.id !== threadId ? t : { ...t, messages: t.messages.map((m) => (m.id === messageId ? change(m) : m)) }
  );

export const useSessionStore = create<SessionState>((set, get) => ({
  transcript: [],
  threads: [],
  activeThreadId: null,
  solvingMessageId: null,
  askedQuestion: null,
  likelyQuestions: [],
  pickedOption: null,
  optionsError: null,
  askDraft: "",
  askUsesScreen: true,
  optionsUseScreen: false,

  addTranscriptTurn: (turn) => {
    const id =
      turn.id || `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    set((state) => ({
      transcript: [...state.transcript, { ...turn, id }],
    }));
  },

  beginMessage: ({ question, kind, newThread, retryMessageId }) => {
    const { threads, activeThreadId } = get();

    if (retryMessageId) {
      for (const thread of threads) {
        const index = thread.messages.findIndex((m) => m.id === retryMessageId);
        if (index === -1) continue;
        set({
          threads: mapMessage(threads, thread.id, retryMessageId, (m) => ({
            ...m,
            viewedScreen: false,
            solution: null,
            error: null,
          })),
        });
        return { threadId: thread.id, messageId: retryMessageId, before: thread.messages.slice(0, index) };
      }
      return null;
    }

    const message: ThreadMessage = {
      id: newId("msg"),
      question,
      kind,
      viewedScreen: false,
      solution: null,
      error: null,
    };
    const current = threads.find((t) => t.id === activeThreadId);
    if (current && !newThread) {
      set({
        threads: threads.map((t) => (t === current ? { ...t, messages: [...t.messages, message] } : t)),
      });
      return { threadId: current.id, messageId: message.id, before: current.messages };
    }

    const thread: Thread = { id: newId("thread"), startedAt: Date.now(), messages: [message] };
    set({ threads: [thread, ...threads], activeThreadId: thread.id });
    return { threadId: thread.id, messageId: message.id, before: [] };
  },

  // A write for a message that was cleared or never existed does nothing
  updateMessage: (threadId, messageId, patch) =>
    set((state) => {
      const exists = state.threads.some((t) => t.id === threadId && t.messages.some((m) => m.id === messageId));
      if (!exists) return {};
      return { threads: mapMessage(state.threads, threadId, messageId, (m) => ({ ...m, ...patch })) };
    }),

  stopMessage: (threadId, messageId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      const message = thread?.messages.find((m) => m.id === messageId);
      if (!thread || !message) return {};
      if (hasAnswer(message.solution)) {
        return { threads: mapMessage(state.threads, threadId, messageId, (m) => ({ ...m, error: STOPPED_MESSAGE })) };
      }
      const messages = thread.messages.filter((m) => m.id !== messageId);
      if (messages.length > 0) {
        return { threads: state.threads.map((t) => (t.id === threadId ? { ...t, messages } : t)) };
      }
      // Nothing was answered in this chat: it leaves history too
      return {
        threads: state.threads.filter((t) => t.id !== threadId),
        activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      };
    }),

  openThread: (threadId) =>
    set((state) =>
      state.threads.some((t) => t.id === threadId) ? { activeThreadId: threadId, pickedOption: null } : {}
    ),

  clearAnswer: () => {
    cancelSolve();
    set({ activeThreadId: null, pickedOption: null, solvingMessageId: null });
  },

  clearThreads: () => {
    // Cancel first, so a running answer is stopped while its message still exists
    cancelSolve();
    set({ threads: [], activeThreadId: null, solvingMessageId: null, askDraft: "", pickedOption: null });
  },

  clearSession: () => {
    get().clearThreads();
    set({
      transcript: [],
      askedQuestion: null,
      likelyQuestions: [],
      optionsError: null,
    });
  },
}));
