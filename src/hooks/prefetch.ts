import { useSessionStore, ProgressiveSolution } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { buildUserPrompt, currentSystemParts } from "../services/ai/promptTemplates";
import { dispatchDeepSolve, getDefaultModelForProvider, reasoningFor } from "../services/ai/dispatcher";
import { formatTranscript } from "../services/ai/liveOptions";

/**
 * The answer to the asked question, generated in the background without the screen and shown only if the
 * user picks that question. Only one exists. A pick adopts it: a finished one answers at once, a running one
 * streams into the new message.
 */
export interface Prefetch {
  question: string;
  status: "running" | "done" | "error";
  /** The latest partial answer, then the final one */
  solution: ProgressiveSolution | null;
  controller: AbortController;
  /** Settles with the final answer; rejects on failure or abort */
  finished: Promise<ProgressiveSolution>;
  /** Set by the solve that adopts a running prefetch: it receives each partial answer */
  onUpdate?: (solution: ProgressiveSolution) => void;
}

/** A question that changes again within this window restarts it, so rewording isn't billed call by call */
const START_DELAY_MS = 400;

let current: Prefetch | null = null;
let startTimer: ReturnType<typeof setTimeout> | undefined;

const sameQuestion = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function discardPrefetch() {
  current?.controller.abort();
  current = null;
}

function cancelPendingStart() {
  clearTimeout(startTimer);
  startTimer = undefined;
}

/** Starts a prefetch for the asked question once START_DELAY_MS pass without another change. */
function scheduleStart() {
  cancelPendingStart();
  if (!useSessionStore.getState().askedQuestion) return;
  startTimer = setTimeout(() => {
    startTimer = undefined;
    const question = useSessionStore.getState().askedQuestion;
    if (question) startPrefetch(question);
  }, START_DELAY_MS);
}

function startPrefetch(question: string) {
  discardPrefetch();
  const session = useSessionStore.getState();
  const app = useAppStore.getState();
  // Only while listening: a late options answer after Stop must not bill a call
  if (session.optionsUseScreen || app.isPanicked || app.meetingStatus !== "live") return;

  const settings = useSettingsStore.getState();
  const provider = settings.selectedProvider || "openrouter";
  const controller = new AbortController();
  let resolve!: (solution: ProgressiveSolution) => void;
  let reject!: (err: unknown) => void;
  const job: Prefetch = {
    question,
    status: "running",
    solution: null,
    controller,
    finished: new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  };
  // Most prefetches are never picked, and their failure must not surface as an unhandled rejection
  job.finished.catch(() => {});
  current = job;

  const { prefix, suffix } = currentSystemParts(settings);
  dispatchDeepSolve({
    provider,
    apiKey: settings.apiKeys[provider] || "",
    model: settings.selectedModel || getDefaultModelForProvider(provider),
    prompt: buildUserPrompt(question, {
      transcript: formatTranscript(session.transcript),
      hasImage: false,
      history: [],
    }),
    systemPrefix: prefix,
    systemSuffix: suffix,
    reasoning: reasoningFor("option", settings),
    signal: controller.signal,
    onProgressiveUpdate: (solution) => {
      if (controller.signal.aborted) return;
      job.solution = solution;
      job.onUpdate?.(solution);
    },
  }).then(
    (solution) => {
      job.status = "done";
      job.solution = solution;
      resolve(solution);
    },
    (err) => {
      if (!controller.signal.aborted) job.status = "error";
      reject(err);
    }
  );
}

/**
 * The prefetch for a picked question, if it is for this question and has not failed. Taking it ends the
 * prefetch: the solve that takes it owns the answer from then on.
 */
export function takePrefetch(question: string): Prefetch | null {
  if (!current || !sameQuestion(current.question, question)) return null;
  const job = current;
  current = null;
  return job.status === "error" ? null : job;
}

/**
 * Keeps one prefetch in step with the asked question and the settings it was built with. A new question
 * starts its prefetch after a short quiet period; a settings change restarts it; the screen toggle and
 * Stop, panic and Burn (`sidekick:discard_prefetch`) stop it. Returns the cleanup.
 */
export function initPrefetch(): () => void {
  const onDiscard = () => {
    cancelPendingStart();
    discardPrefetch();
  };
  window.addEventListener("sidekick:discard_prefetch", onDiscard);

  const unsubSession = useSessionStore.subscribe((state, prev) => {
    if (state.optionsUseScreen !== prev.optionsUseScreen) {
      if (state.optionsUseScreen) onDiscard();
      else scheduleStart();
    }
    if (state.askedQuestion === prev.askedQuestion) return;
    if (!state.askedQuestion) onDiscard();
    else if (!current || !sameQuestion(current.question, state.askedQuestion)) {
      discardPrefetch();
      scheduleStart();
    }
  });

  const unsubSettings = useSettingsStore.subscribe((state, prev) => {
    if (
      state.activeModeId !== prev.activeModeId ||
      state.modes !== prev.modes ||
      state.outputLanguage !== prev.outputLanguage ||
      state.selectedProvider !== prev.selectedProvider ||
      state.selectedModel !== prev.selectedModel ||
      state.profile !== prev.profile ||
      // Only the thinking that option picks run with matters here; a level change with picks off leaves it be
      reasoningFor("option", state) !== reasoningFor("option", prev)
    ) {
      discardPrefetch();
      scheduleStart();
    }
  });

  return () => {
    window.removeEventListener("sidekick:discard_prefetch", onDiscard);
    unsubSession();
    unsubSettings();
    onDiscard();
  };
}
