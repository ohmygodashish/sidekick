import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ProgressiveCard } from "../components/cards/ProgressiveCard";
import { CodeBlock } from "../components/cards/CodeBlock";
import { AnswerPanel } from "../components/answer/AnswerPanel";
import { useSessionStore, ProgressiveSolution, requestSolve } from "../store/sessionStore";
import { useAppStore } from "../store/appStore";

const solution: ProgressiveSolution = {
  stage1Intuition: {
    verbalSummary: "Use a sliding window counter backed by a sorted set.",
    keyTradeoffs: ["Trade A", "Trade B", "Trade C", "Trade D"],
  },
  stage2Code: {
    language: "python",
    code: "def allow(key):\n    return True",
    explanation: "Checks the window.",
  },
  stage3Analysis: {
    timeComplexity: "O(log N)",
    spaceComplexity: "O(N)",
    edgeCases: ["Empty window", "Clock skew"],
  },
};

const regionOf = (row: HTMLElement) => document.getElementById(row.getAttribute("aria-controls")!)!;

describe("ProgressiveCard", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    useAppStore.setState({ isAskOpen: false });
  });

  it("renders the summary and up to four tradeoffs, the four STAR talking points", () => {
    render(<ProgressiveCard solution={solution} />);

    expect(screen.getByTestId("answer-summary").textContent).toBe(
      "Use a sliding window counter backed by a sorted set."
    );
    expect(screen.getByText("Trade A")).toBeDefined();
    expect(screen.getByText("Trade D")).toBeDefined();
    expect(screen.queryAllByRole("listitem").filter((li) => li.textContent?.startsWith("Trade")).length).toBe(4);
  });

  it("shows the code expanded by default and collapses it", () => {
    render(<ProgressiveCard solution={solution} />);

    const row = screen.getByTestId("answer-code-row");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(regionOf(row).hasAttribute("hidden")).toBe(false);
    expect(regionOf(row).textContent).toContain("def allow(key):");

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(regionOf(row).hasAttribute("hidden")).toBe(true);
  });

  it("shows complexity collapsed by default and expands it to the edge cases", () => {
    render(<ProgressiveCard solution={solution} />);

    const row = screen.getByTestId("answer-complexity-row");
    expect(row.textContent).toContain("O(log N) time · O(N) space");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(regionOf(row).hasAttribute("hidden")).toBe(true);

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(regionOf(row).hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("Empty window")).toBeDefined();
    expect(screen.getByText("Clock skew")).toBeDefined();
  });

  it("skips list items that are not strings", () => {
    const messy = {
      ...solution,
      stage1Intuition: {
        verbalSummary: "Summary",
        keyTradeoffs: ["Real tradeoff", { point: "object" }, 42] as unknown as string[],
      },
      stage3Analysis: {
        timeComplexity: "O(1)",
        spaceComplexity: "O(1)",
        edgeCases: [{ case: "object" }, "Real edge"] as unknown as string[],
      },
    };
    render(<ProgressiveCard solution={messy} />);
    fireEvent.click(screen.getByTestId("answer-complexity-row"));

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Real tradeoff", "Real edge"]);
  });

  it("hides a half-received tag instead of showing it as the summary", () => {
    render(
      <ProgressiveCard
        solution={{ ...solution, stage1Intuition: { verbalSummary: "  <verbal_su", keyTradeoffs: [] } }}
      />
    );

    expect(screen.queryByTestId("answer-summary")).toBeNull();
    expect(screen.queryByText(/<verbal/)).toBeNull();
  });

  it("renders nothing without a solution", () => {
    const { container } = render(<ProgressiveCard solution={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CodeBlock", () => {
  const python = [
    "INF = 1e9 + 7",
    "mask = 0xFF & x",
    "big = 1_000_000 // 3",
    's = "a\\"b"',
  ];

  const commentTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".italic"), (el) => el.textContent);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders every line of python exactly as written", () => {
    const { container } = render(<CodeBlock code={python.join("\n")} language="python" />);

    const lines = container.querySelector("pre")!.textContent!.split("\n");
    expect(lines).toEqual(python);
  });

  it("does not style python // as a comment but styles # as one", () => {
    const { container } = render(
      <CodeBlock code={"mid = (lo + hi) // 2\n# note"} language="python" />
    );

    expect(commentTexts(container)).toEqual(["# note"]);
  });

  it("styles // as a comment in javascript", () => {
    const { container } = render(<CodeBlock code="const x = 1; // note" language="javascript" />);

    expect(commentTexts(container)).toEqual(["// note"]);
  });

  it("shows Copied only after the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code="x = 1" language="python" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledWith("x = 1");
  });

  it("keeps the Copy label when the clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code="x = 1" language="python" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("keeps the Copy label when the clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CodeBlock code="x = 1" language="python" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {});

    expect(screen.queryByText("Copied")).toBeNull();
  });
});

describe("AnswerPanel", () => {
  const seed = (question = "Design a rate limiter?", kind: "typed" | "option" | "assist" = "typed", newThread = true) =>
    useSessionStore.getState().beginMessage({ question, kind, newThread })!;

  // Lets the test play the solver: the answer lands in the message the panel shows
  const answer = (messageId: string, threadId: string, value: ProgressiveSolution) =>
    useSessionStore.getState().updateMessage(threadId, messageId, { solution: value });

  beforeEach(() => {
    useSessionStore.getState().clearSession();
    useSessionStore.setState({ askDraft: "", askUsesScreen: true, optionsUseScreen: false });
    useAppStore.setState({ isAskOpen: false });
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<AnswerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the question once, above its answer, without quick pointers", () => {
    const { threadId, messageId } = seed();
    answer(messageId, threadId, solution);
    render(<AnswerPanel />);

    expect(screen.getByRole("region", { name: "Answer" })).toBeDefined();
    expect(screen.getAllByText("Design a rate limiter?")).toHaveLength(1);
    expect(screen.queryByText("Token bucket")).toBeNull();
    expect(screen.getByTestId("answer-summary")).toBeDefined();
  });

  it("labels an answer that viewed the screen", () => {
    const { threadId, messageId } = seed();
    useSessionStore.getState().updateMessage(threadId, messageId, { viewedScreen: true });
    render(<AnswerPanel />);

    expect(screen.getByText("Viewed screen")).toBeDefined();
  });

  it("shows Thinking only on the message being streamed", () => {
    const first = seed("First?");
    answer(first.messageId, first.threadId, solution);
    const second = useSessionStore.getState().beginMessage({ question: "Second?", kind: "typed", newThread: false });
    useSessionStore.setState({ solvingMessageId: second!.messageId });
    render(<AnswerPanel />);

    expect(screen.getAllByText("Thinking…")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Thinking…");
    expect(screen.getByTestId("answer-summary")).toBeDefined();
  });

  it("shows the error with a Retry on the last message that reruns that message", () => {
    const { threadId, messageId } = seed("Model question?");
    useSessionStore.getState().updateMessage(threadId, messageId, { error: "Model timed out" });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);

    expect(screen.getByRole("alert").textContent).toContain("Model timed out");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      question: "Model question?",
      kind: "typed",
      retryMessageId: messageId,
    });
  });

  it("an older failed message shows its error without Retry", () => {
    const failed = seed("Failed?");
    useSessionStore.getState().updateMessage(failed.threadId, failed.messageId, { error: "Old failure" });
    const next = useSessionStore.getState().beginMessage({ question: "Next?", kind: "typed", newThread: false });
    answer(next!.messageId, next!.threadId, solution);
    render(<AnswerPanel />);

    expect(screen.getByRole("alert").textContent).toContain("Old failure");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("close ends the thread, keeps it in history and closes Ask", () => {
    seed();
    useAppStore.setState({ isAskOpen: true });
    const { container } = render(<AnswerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useSessionStore.getState().activeThreadId).toBeNull();
    expect(useSessionStore.getState().threads).toHaveLength(1);
    expect(useAppStore.getState().isAskOpen).toBe(false);
    expect(container.firstChild).toBeNull();
  });

  it("New chat ends the thread but keeps Ask open, empty, and without a pick", () => {
    seed();
    useSessionStore.setState({ askDraft: "half typed", pickedOption: "A pick" });
    useAppStore.setState({ isAskOpen: true });
    render(<AnswerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(useSessionStore.getState().activeThreadId).toBeNull();
    expect(useSessionStore.getState().threads).toHaveLength(1);
    expect(useSessionStore.getState().pickedOption).toBeNull();
    expect(useAppStore.getState().isAskOpen).toBe(true);
    const input = screen.getByPlaceholderText("Ask about your screen or type a question…") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.queryByText("Design a rate limiter?")).toBeNull();
    // Opening the fresh box does not take focus
    expect(document.activeElement).not.toBe(input);
  });

  it("New chat is disabled while no chat is open, and History stays enabled", () => {
    useAppStore.setState({ isAskOpen: true });
    render(<AnswerPanel />);

    expect((screen.getByRole("button", { name: "New chat" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "History" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a follow-up continues the thread, dispatches the solve and clears the input", () => {
    const { threadId, messageId } = seed();
    answer(messageId, threadId, solution);
    useAppStore.setState({ isAskOpen: true });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);
    const input = screen.getByLabelText("Ask a follow-up") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "  How would you shard it?  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      question: "How would you shard it?",
      kind: "typed",
      captureWindow: true,
    });
    expect(input.value).toBe("");
    expect(useAppStore.getState().isAskOpen).toBe(false);
  });

  it("Cmd+Enter also submits a follow-up", () => {
    useAppStore.setState({ isAskOpen: true });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);
    const input = screen.getByLabelText("Ask a follow-up");

    fireEvent.change(input, { target: { value: "Edge cases?" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    window.removeEventListener("sidekick:deep_solve", listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.question).toBe("Edge cases?");
  });

  it("an empty follow-up does nothing", () => {
    useAppStore.setState({ isAskOpen: true });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);

    const input = screen.getByLabelText("Ask a follow-up");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).not.toHaveBeenCalled();
    expect(useSessionStore.getState().threads).toHaveLength(0);
    expect(screen.getByPlaceholderText("Ask about your screen or type a question…")).toBeDefined();
  });

  it("the Ask box's screen toggle is on by default and can be turned off", () => {
    useAppStore.setState({ isAskOpen: true });
    render(<AnswerPanel />);
    const toggle = screen.getByRole("button", { name: "Include screen" });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(useSessionStore.getState().askUsesScreen).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("requestSolve is what a follow-up dispatches", () => {
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    requestSolve({ question: "Direct?" });
    window.removeEventListener("sidekick:deep_solve", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
