import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ProgressiveCard } from "../components/cards/ProgressiveCard";
import { CodeBlock } from "../components/cards/CodeBlock";
import { ComplexityBadge } from "../components/cards/ComplexityBadge";
import { useSessionStore } from "../store/sessionStore";

describe("ProgressiveCard & Progressive Disclosure Engine", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    vi.restoreAllMocks();
  });

  const mockFullSolution = {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    stage1Intuition: {
      verbalSummary:
        "We can model this as a sliding window counter using Redis sorted sets.",
      keyTradeoffs: [
        "Sorted sets provide O(log N) insert with atomic ZREMRANGEBYSCORE",
        "Higher memory consumption per key than token bucket",
      ],
    },
    stage2Code: {
      language: "python",
      code: "class RateLimiter:\n    def __init__(self, limit: int):\n        self.limit = limit\n        self.tokens = 100",
      explanation: "Sliding window rate limiter with atomic sliding window eviction.",
    },
    stage3Analysis: {
      timeComplexity: "O(log N)",
      spaceComplexity: "O(N)",
      edgeCases: [
        "Clock drift between distributed Redis nodes",
        "Sub-millisecond concurrent bursts",
      ],
    },
  };

  it("renders mock solution schema: Stage 1 intuition, Stage 2 code with badge, Stage 3 complexity", () => {
    useSessionStore.getState().setSolution(mockFullSolution);

    render(<ProgressiveCard />);

    // Overall container
    expect(screen.getByTestId("progressive-card")).toBeDefined();

    // Stage 1: Intuition & Trade-offs
    const stage1Card = screen.getByTestId("progressive-stage1-card");
    expect(stage1Card).toBeDefined();
    expect(screen.getByText("Stage 1: Intuition & Tradeoffs")).toBeDefined();
    expect(
      screen.getByText(/We can model this as a sliding window counter/)
    ).toBeDefined();
    expect(screen.getByText(/Sorted sets provide O\(log N\) insert/)).toBeDefined();

    // Stage 2: Code block with language badge and explanation
    const stage2Card = screen.getByTestId("progressive-stage2-card");
    expect(stage2Card).toBeDefined();
    expect(screen.getByText("Stage 2: Code (python)")).toBeDefined();
    expect(
      screen.getByText(/Sliding window rate limiter with atomic/)
    ).toBeDefined();
    expect(screen.getByTestId("code-language-badge").textContent).toBe("python");
    expect(screen.getByTestId("code-block")).toBeDefined();

    // Stage 3: Analysis with complexity badges and edge cases
    const stage3Card = screen.getByTestId("progressive-stage3-card");
    expect(stage3Card).toBeDefined();
    expect(screen.getByText("Stage 3: Complexity & Edge Cases")).toBeDefined();
    expect(screen.getByText("Time: O(log N)")).toBeDefined();
    expect(screen.getByText("Space: O(N)")).toBeDefined();
    expect(
      screen.getByText("Clock drift between distributed Redis nodes")
    ).toBeDefined();
  });

  it("renders Stage 1 first during partial/streaming responses (AC-006)", () => {
    // Only Stage 1 is initially available
    useSessionStore.getState().setStage1Intuition({
      verbalSummary: "Binary search on partition ranges of smaller array.",
      keyTradeoffs: ["O(log(min(M, N))) runtime"],
    });

    const { rerender } = render(<ProgressiveCard />);

    // Stage 1 is rendered and open
    expect(screen.getByTestId("progressive-stage1-card")).toBeDefined();
    expect(
      screen.getByText("Binary search on partition ranges of smaller array.")
    ).toBeDefined();

    // Stages 2 and 3 should not be present yet
    expect(screen.queryByTestId("progressive-stage2-card")).toBeNull();
    expect(screen.queryByTestId("progressive-stage3-card")).toBeNull();

    // Stage 2 arrives incrementally
    act(() => {
      useSessionStore.getState().setStage2Code({
        language: "typescript",
        code: "function findMedian(): number { return 0; }",
        explanation: "Binary search over shorter array",
      });
    });
    rerender(<ProgressiveCard />);

    expect(screen.getByTestId("progressive-stage2-card")).toBeDefined();
    expect(screen.getByText("Stage 2: Code (typescript)")).toBeDefined();
    expect(screen.queryByTestId("progressive-stage3-card")).toBeNull();

    // Stage 3 arrives incrementally
    act(() => {
      useSessionStore.getState().setStage3Analysis({
        timeComplexity: "O(log(min(M, N)))",
        spaceComplexity: "O(1)",
        edgeCases: ["Empty array", "Single element array"],
      });
    });
    rerender(<ProgressiveCard />);

    expect(screen.getByTestId("progressive-stage3-card")).toBeDefined();
    expect(screen.getByText("Time: O(log(min(M, N)))")).toBeDefined();
  });

  it("toggles collapsible tiers when clicking header accordion buttons", () => {
    useSessionStore.getState().setSolution(mockFullSolution);

    render(<ProgressiveCard />);

    const stage1Toggle = screen.getByTestId("progressive-stage1-toggle");
    const stage2Toggle = screen.getByTestId("progressive-stage2-toggle");
    const stage3Toggle = screen.getByTestId("progressive-stage3-toggle");

    // All stages open by default
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();
    expect(screen.getByTestId("progressive-stage2-content")).toBeDefined();
    expect(screen.getByTestId("progressive-stage3-content")).toBeDefined();

    // Collapse Stage 1
    fireEvent.click(stage1Toggle);
    expect(screen.queryByTestId("progressive-stage1-content")).toBeNull();

    // Collapse Stage 2
    fireEvent.click(stage2Toggle);
    expect(screen.queryByTestId("progressive-stage2-content")).toBeNull();

    // Collapse Stage 3
    fireEvent.click(stage3Toggle);
    expect(screen.queryByTestId("progressive-stage3-content")).toBeNull();

    // Re-expand Stage 1
    fireEvent.click(stage1Toggle);
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();
  });

  it("toggles stages using keyboard hotkeys 1, 2, 3", () => {
    useSessionStore.getState().setSolution(mockFullSolution);

    render(<ProgressiveCard />);

    // Initially open
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();
    expect(screen.getByTestId("progressive-stage2-content")).toBeDefined();
    expect(screen.getByTestId("progressive-stage3-content")).toBeDefined();

    // Press '1' to collapse Stage 1
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.queryByTestId("progressive-stage1-content")).toBeNull();

    // Press '2' to collapse Stage 2
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.queryByTestId("progressive-stage2-content")).toBeNull();

    // Press '3' to collapse Stage 3
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.queryByTestId("progressive-stage3-content")).toBeNull();

    // Press '1' again to re-expand Stage 1
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();

    // Press '2' again to re-expand Stage 2
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByTestId("progressive-stage2-content")).toBeDefined();

    // Press '3' again to re-expand Stage 3
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByTestId("progressive-stage3-content")).toBeDefined();
  });

  it("ignores hotkeys when typing in input or textarea elements", () => {
    useSessionStore.getState().setSolution(mockFullSolution);

    render(
      <div>
        <input data-testid="test-input" type="text" />
        <ProgressiveCard />
      </div>
    );

    const input = screen.getByTestId("test-input");
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();

    // Type '1' in input: should NOT collapse Stage 1
    fireEvent.keyDown(input, { key: "1" });
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();
  });

  it("ignores hotkeys when modifier keys (metaKey, ctrlKey, altKey) are pressed", () => {
    useSessionStore.getState().setSolution(mockFullSolution);

    render(<ProgressiveCard />);

    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();

    // Press Cmd + 1 (browser tab switch) -> should NOT collapse Stage 1
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(screen.getByTestId("progressive-stage1-content")).toBeDefined();

    // Press Ctrl + 2 -> should NOT collapse Stage 2
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(screen.getByTestId("progressive-stage2-content")).toBeDefined();
  });

  it("renders compact variant with custom testIdPrefix for NotchCompanion", () => {
    render(
      <ProgressiveCard
        solution={mockFullSolution}
        variant="compact"
        testIdPrefix="notch"
      />
    );

    expect(screen.getByTestId("notch-stage1-card")).toBeDefined();
    expect(screen.getByText("Intuition & Tradeoffs")).toBeDefined();
    expect(screen.getByTestId("notch-stage2-card")).toBeDefined();
    expect(screen.getByText("Code Solution")).toBeDefined();
    expect(screen.getByTestId("notch-stage3-card")).toBeDefined();
    expect(screen.getByText("Complexity & Edge Cases")).toBeDefined();
  });

  it("renders null gracefully when no stages are available and not streaming", () => {
    const { container } = render(<ProgressiveCard solution={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CodeBlock Component", () => {
  it("renders syntax-highlighted code lines with line numbers and language badge", () => {
    const sampleCode = "def add(a: int, b: int) -> int:\n    return a + b";

    render(<CodeBlock code={sampleCode} language="python" />);

    const block = screen.getByTestId("code-block");
    expect(block).toBeDefined();

    // Language badge
    const badge = screen.getByTestId("code-language-badge");
    expect(badge.textContent).toBe("python");

    // Line numbers
    expect(screen.getByTestId("line-number-1").textContent).toBe("1");
    expect(screen.getByTestId("line-number-2").textContent).toBe("2");

    // Syntax-highlighted keywords & types
    expect(screen.getByText("def").className).toContain("text-purple-400");
    expect(screen.getByText("return").className).toContain("text-purple-400");
    const intTokens = screen.getAllByText("int");
    expect(intTokens[0].className).toContain("text-cyan-300");
  });

  it("copies code to clipboard when clicking copy button", async () => {
    const sampleCode = "const message = 'Hello World';";
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<CodeBlock code={sampleCode} language="typescript" />);

    const copyBtn = screen.getByTestId("code-copy-btn");
    expect(screen.getByText("Copy")).toBeDefined();

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith(sampleCode);
    expect(screen.getByText("Copied!")).toBeDefined();
  });

  it("copies code to clipboard via Cmd + C keyboard shortcut when focused", async () => {
    const sampleCode = "fn main() { println!(\"Hello\"); }";
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<CodeBlock code={sampleCode} language="rust" />);

    const block = screen.getByTestId("code-block");

    await act(async () => {
      fireEvent.keyDown(block, { key: "c", metaKey: true });
    });

    expect(writeTextMock).toHaveBeenCalledWith(sampleCode);
    expect(screen.getByText("Copied!")).toBeDefined();
  });
});

describe("ComplexityBadge Component", () => {
  it("renders both Time and Space complexity badges", () => {
    render(
      <ComplexityBadge timeComplexity="O(log N)" spaceComplexity="O(1)" />
    );

    const timeBadge = screen.getByTestId("complexity-badge-time");
    const spaceBadge = screen.getByTestId("complexity-badge-space");

    expect(timeBadge.textContent).toBe("Time: O(log N)");
    expect(spaceBadge.textContent).toBe("Space: O(1)");
    expect(timeBadge.className).toContain("text-amber-300");
    expect(spaceBadge.className).toContain("text-purple-300");
  });

  it("renders individual Time badge when type='time'", () => {
    render(<ComplexityBadge type="time" complexity="O(N log N)" />);

    expect(screen.getByTestId("complexity-badge-time").textContent).toBe(
      "Time: O(N log N)"
    );
    expect(screen.queryByTestId("complexity-badge-space")).toBeNull();
  });

  it("renders individual Space badge when type='space'", () => {
    render(<ComplexityBadge type="space" complexity="O(N)" />);

    expect(screen.getByTestId("complexity-badge-space").textContent).toBe(
      "Space: O(N)"
    );
    expect(screen.queryByTestId("complexity-badge-time")).toBeNull();
  });
});
