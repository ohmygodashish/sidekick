import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotchCompanion } from "../components/hud/NotchCompanion";
import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";

describe("NotchCompanion", () => {
  beforeEach(() => {
    useAppStore.setState({
      layoutMode: "dynamic_notch",
      opacity: 0.85,
      isClickThrough: false,
      isVisible: true,
      isPanicked: false,
    });
    useSessionStore.getState().clearSession();
  });

  it("renders in collapsed mode with draggable bar and live audio waveform", () => {
    render(<NotchCompanion />);

    const companion = screen.getByTestId("notch-companion");
    expect(companion).toBeDefined();
    expect(companion.getAttribute("aria-expanded")).toBe("false");
    expect(companion.className).toContain("w-[380px]");
    expect(companion.className).toContain("h-[42px]");

    // Draggable header bar for Tauri window
    const bar = screen.getByTestId("notch-bar");
    expect(bar.getAttribute("data-tauri-drag-region")).not.toBeNull();

    // 5-bar Waveform indicator
    const waveform = screen.getByTestId("notch-waveform");
    expect(waveform).toBeDefined();
    expect(waveform.children.length).toBe(5);

    // Default idle label and status
    expect(screen.getByText("Listening")).toBeDefined();
    expect(screen.getByText("Notch Copilot")).toBeDefined();

    // Expanded content should not be visible when collapsed
    expect(screen.queryByTestId("notch-expanded-content")).toBeNull();
  });

  it("expands downwards smoothly on hover and collapses on mouse leave", () => {
    render(<NotchCompanion />);

    const companion = screen.getByTestId("notch-companion");

    // Hover to expand
    fireEvent.mouseEnter(companion);
    expect(companion.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("notch-expanded-content")).toBeDefined();
    expect(screen.getByText("Webcam Eye Contact Mode")).toBeDefined();
    expect(
      screen.getByText(/Positioned directly beneath your camera lens/i)
    ).toBeDefined();

    // Mouse leave to collapse
    fireEvent.mouseLeave(companion);
    expect(companion.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("notch-expanded-content")).toBeNull();
  });

  it("toggles expansion manually using the chevron expand button", () => {
    render(<NotchCompanion />);

    const companion = screen.getByTestId("notch-companion");
    const expandBtn = screen.getByTestId("notch-expand-btn");

    expect(companion.getAttribute("aria-expanded")).toBe("false");

    // Click to expand
    fireEvent.click(expandBtn);
    expect(companion.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("notch-expanded-content")).toBeDefined();

    // Click to collapse
    fireEvent.click(expandBtn);
    expect(companion.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("notch-expanded-content")).toBeNull();
  });

  it("automatically expands and displays extracted question when activeQuestion is set", () => {
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_sys_design",
      timestamp: Date.now(),
      confidence: 0.95,
      rawTranscript: "How would you design a distributed cache like Redis?",
      extractedQuestion: "Design a distributed in-memory key-value cache",
      quickPointers: [
        "Consistent hashing for sharding",
        "LRU eviction policy",
        "Write-through vs write-back replication",
      ],
    });

    render(<NotchCompanion />);

    const companion = screen.getByTestId("notch-companion");
    // Should be automatically expanded
    expect(companion.getAttribute("aria-expanded")).toBe("true");

    // Headline in top bar
    const headline = screen.getByTestId("notch-headline");
    expect(headline.textContent).toBe(
      "Design a distributed in-memory key-value cache"
    );

    // Full question card in expanded content
    const questionCard = screen.getByTestId("notch-question-card");
    expect(questionCard).toBeDefined();
    expect(screen.getByText("95% Match")).toBeDefined();
    expect(screen.getByText("Consistent hashing for sharding")).toBeDefined();
    expect(screen.getByText("LRU eviction policy")).toBeDefined();
  });

  it("allows manual collapse toggle to take precedence even when hovered or when activeQuestion exists", () => {
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_override_test",
      timestamp: Date.now(),
      confidence: 0.99,
      rawTranscript: "How would you implement LRU cache?",
      extractedQuestion: "Implement LRU Cache in Python",
      quickPointers: ["Doubly linked list", "Dict for O(1) lookup"],
    });

    render(<NotchCompanion />);

    const companion = screen.getByTestId("notch-companion");
    const expandBtn = screen.getByTestId("notch-expand-btn");

    // Initially auto-expanded because activeQuestion is present
    expect(companion.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("notch-expanded-content")).toBeDefined();

    // Hover should keep it expanded
    fireEvent.mouseEnter(companion);
    expect(companion.getAttribute("aria-expanded")).toBe("true");

    // Explicit manual toggle should COLLAPSE it even while hovered and question is active!
    fireEvent.click(expandBtn);
    expect(companion.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("notch-expanded-content")).toBeNull();

    // Mouse leave and re-enter: should stay collapsed because of manual override
    fireEvent.mouseLeave(companion);
    fireEvent.mouseEnter(companion);
    expect(companion.getAttribute("aria-expanded")).toBe("false");

    // Clicking expand again should re-expand
    fireEvent.click(expandBtn);
    expect(companion.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("notch-expanded-content")).toBeDefined();
  });

  it("renders progressive solution stages (intuition, code, complexity) when available", () => {
    useSessionStore.getState().setActiveQuestion({
      questionId: "q_algo",
      extractedQuestion: "Find median of two sorted arrays",
      confidence: 0.98,
      quickPointers: ["Binary search on smaller array"],
      rawTranscript: "Find median",
      timestamp: Date.now(),
    });

    useSessionStore.getState().setSolution({
      stage1Intuition: {
        verbalSummary: "Binary search on partition points of the smaller array.",
        keyTradeoffs: ["O(log(min(m, n))) time vs O(m + n) merge"],
      },
      stage2Code: {
        language: "python",
        code: "def findMedianSortedArrays(nums1, nums2): ...",
        explanation: "Binary search on shorter array partition",
      },
      stage3Analysis: {
        timeComplexity: "O(log(min(m, n)))",
        spaceComplexity: "O(1)",
        edgeCases: ["Empty array", "Non-overlapping ranges"],
      },
    });

    render(<NotchCompanion />);

    // Stage 1
    const stage1 = screen.getByTestId("notch-stage1-card");
    expect(stage1).toBeDefined();
    expect(screen.getByText("Intuition & Tradeoffs")).toBeDefined();
    expect(
      screen.getByText(/Binary search on partition points/)
    ).toBeDefined();
    expect(screen.getByText(/O\(log\(min\(m, n\)\)\) time/)).toBeDefined();

    // Stage 2
    const stage2 = screen.getByTestId("notch-stage2-card");
    expect(stage2).toBeDefined();
    expect(screen.getByText("Code Solution")).toBeDefined();
    expect(screen.getByText("python")).toBeDefined();
    expect(screen.getByText(/def findMedianSortedArrays/)).toBeDefined();

    // Stage 3
    const stage3 = screen.getByTestId("notch-stage3-card");
    expect(stage3).toBeDefined();
    expect(screen.getByText("Complexity & Edge Cases")).toBeDefined();
    expect(screen.getByText("Time: O(log(min(m, n)))")).toBeDefined();
    expect(screen.getByText("Space: O(1)")).toBeDefined();
    expect(screen.getByText("Empty array")).toBeDefined();
  });

  it("updates live speaker badge based on session transcript", () => {
    const { rerender } = render(<NotchCompanion />);
    expect(screen.getByText("Listening")).toBeDefined();

    act(() => {
      useSessionStore.getState().addTranscriptTurn({
        speaker: "interviewer",
        text: "Could you walk me through your concurrency model?",
        timestamp: Date.now(),
      });
    });
    rerender(<NotchCompanion />);
    expect(screen.getByText("Interviewer")).toBeDefined();

    act(() => {
      useSessionStore.getState().addTranscriptTurn({
        speaker: "candidate",
        text: "We use an actor-based model with Tokio tasks.",
        timestamp: Date.now(),
      });
    });
    rerender(<NotchCompanion />);
    expect(screen.getByText("Candidate")).toBeDefined();
  });

  it("switches layout mode to floating_hud when clicking LayoutSwitcher", () => {
    render(<NotchCompanion />);

    const switcher = screen.getByTestId("layout-switcher");
    expect(useAppStore.getState().layoutMode).toBe("dynamic_notch");

    fireEvent.click(switcher);
    expect(useAppStore.getState().layoutMode).toBe("floating_hud");
  });

  it("supports toolbar actions (click-through, panic, resume) in expanded drawer", () => {
    // Manually expand to expose toolbar
    render(<NotchCompanion />);
    fireEvent.click(screen.getByTestId("notch-expand-btn"));

    // Toggle click-through
    const clickThroughBtn = screen.getByText("Clickable");
    fireEvent.click(clickThroughBtn);
    expect(useAppStore.getState().isClickThrough).toBe(true);

    // Trigger panic
    const panicBtn = screen.getByText("Panic");
    fireEvent.click(panicBtn);
    expect(useAppStore.getState().isPanicked).toBe(true);
    expect(screen.getByText("Panic Mode Active")).toBeDefined();

    // Resume from panic
    const resumeBtn = screen.getByText("Resume");
    fireEvent.click(resumeBtn);
    expect(useAppStore.getState().isPanicked).toBe(false);
  });
});
