import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ProgressiveCard } from "../components/cards/ProgressiveCard";
import { CodeBlock } from "../components/cards/CodeBlock";
import { AnswerPanel } from "../components/answer/AnswerPanel";
import { useSessionStore, ProgressiveSolution, DetectedQuestion } from "../store/sessionStore";
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

const question: DetectedQuestion = {
  questionId: "q_1",
  timestamp: 0,
  confidence: 0.9,
  rawTranscript: "raw transcript",
  extractedQuestion: "Design a rate limiter?",
  quickPointers: ["Token bucket", "Redis Lua"],
};

const regionOf = (row: HTMLElement) => document.getElementById(row.getAttribute("aria-controls")!)!;

describe("ProgressiveCard", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    useAppStore.setState({ isAskOpen: false });
  });

  it("renders the summary and at most three tradeoffs", () => {
    render(<ProgressiveCard solution={solution} />);

    expect(screen.getByTestId("answer-summary").textContent).toBe(
      "Use a sliding window counter backed by a sorted set."
    );
    expect(screen.getByText("Trade A")).toBeDefined();
    expect(screen.getByText("Trade C")).toBeDefined();
    expect(screen.queryByText("Trade D")).toBeNull();
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
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    useAppStore.setState({ isAskOpen: false });
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<AnswerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the active question without the old quick pointers", () => {
    useSessionStore.getState().setActiveQuestion(question);
    render(<AnswerPanel />);

    expect(screen.getByText("Design a rate limiter?")).toBeDefined();
    expect(screen.queryByText("Token bucket")).toBeNull();
  });

  it("shows Thinking while solving and the answer above it", () => {
    useSessionStore.getState().setActiveQuestion(question);
    useSessionStore.getState().setSolution(solution);
    useSessionStore.setState({ isSolving: true });
    render(<AnswerPanel />);

    expect(screen.getByTestId("answer-summary")).toBeDefined();
    expect(screen.getByText("Thinking…")).toBeDefined();
  });

  it("shows the error with a Retry that re-dispatches the solve", () => {
    useSessionStore.getState().setActiveQuestion(question);
    useSessionStore.setState({ solveError: "Model timed out" });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);

    expect(screen.getByRole("alert").textContent).toContain("Model timed out");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(question);
    window.removeEventListener("sidekick:deep_solve", listener);
  });

  it("close clears the question and solution and closes Ask", () => {
    useSessionStore.getState().setActiveQuestion(question);
    useSessionStore.getState().setSolution(solution);
    useAppStore.setState({ isAskOpen: true });
    const { container } = render(<AnswerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useSessionStore.getState().activeQuestion).toBeNull();
    expect(useSessionStore.getState().progressiveSolution).toBeNull();
    expect(useAppStore.getState().isAskOpen).toBe(false);
    expect(container.firstChild).toBeNull();
  });

  it("a follow-up sets the question, dispatches the solve and clears the input", () => {
    useAppStore.setState({ isAskOpen: true });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);
    const input = screen.getByLabelText("Ask a follow-up") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "  How would you shard it?  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useSessionStore.getState().activeQuestion?.extractedQuestion).toBe(
      "How would you shard it?"
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.extractedQuestion).toBe(
      "How would you shard it?"
    );
    expect(input.value).toBe("");
    expect(useAppStore.getState().isAskOpen).toBe(false);
    window.removeEventListener("sidekick:deep_solve", listener);
  });

  it("Cmd+Enter also submits a follow-up", () => {
    useAppStore.setState({ isAskOpen: true });
    render(<AnswerPanel />);
    const input = screen.getByLabelText("Ask a follow-up");

    fireEvent.change(input, { target: { value: "Edge cases?" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    expect(useSessionStore.getState().activeQuestion?.extractedQuestion).toBe("Edge cases?");
  });

  it("an empty follow-up does nothing", () => {
    useAppStore.setState({ isAskOpen: true });
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);
    render(<AnswerPanel />);

    const input = screen.getByLabelText("Ask a follow-up");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(listener).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeQuestion).toBeNull();
    expect(screen.getByText("Ask anything")).toBeDefined();
    window.removeEventListener("sidekick:deep_solve", listener);
  });
});
