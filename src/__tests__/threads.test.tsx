import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { HistoryMenu } from "../components/answer/HistoryMenu";
import { LiveOptions } from "../components/hud/LiveOptions";
import { AnswerPanel } from "../components/answer/AnswerPanel";
import { ControlBar } from "../components/hud/ControlBar";
import { useSessionStore, activeThreadOf } from "../store/sessionStore";
import { useAppStore, setupAppEventListeners } from "../store/appStore";

// Tauri events the panel listens to, captured so a test can play Rust
const tauri = vi.hoisted(() => ({ handlers: new Map<string, (e: any) => void>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (e: any) => void) => {
    tauri.handlers.set(name, handler);
    return () => tauri.handlers.delete(name);
  },
}));

const state = () => useSessionStore.getState();

const openHistory = () => fireEvent.click(screen.getByRole("button", { name: "History" }));

describe("History menu", () => {
  beforeEach(() => {
    state().clearSession();
    useAppStore.setState({ meetingStatus: "idle", isAskOpen: false });
  });

  it("says No chats yet until this meeting has a chat", () => {
    render(<HistoryMenu />);
    openHistory();
    expect(screen.getByText("No chats yet")).toBeDefined();
  });

  it("lists chats newest first, marks the open one, and reopens a chosen one", () => {
    const first = state().beginMessage({ question: "First chat", kind: "typed", newThread: true })!;
    state().clearAnswer();
    state().beginMessage({ question: "Second chat", kind: "typed", newThread: true });
    render(<HistoryMenu />);

    openHistory();
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Second chat");
    expect(items[1].textContent).toContain("First chat");
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("aria-checked")).toBe("false");
    expect(items[0].textContent).toMatch(/\d{2}:\d{2}/);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /First chat/ }));

    expect(state().activeThreadId).toBe(first.threadId);
    expect(activeThreadOf(state())?.messages[0].question).toBe("First chat");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the menu and returns focus to its trigger", () => {
    state().beginMessage({ question: "A chat", kind: "typed", newThread: true });
    render(<HistoryMenu />);
    openHistory();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "History" }));
  });
});

describe("options card: screen toggle and Assist", () => {
  beforeEach(() => {
    state().clearSession();
    useSessionStore.setState({ optionsUseScreen: false, askUsesScreen: true });
    useAppStore.setState({ meetingStatus: "live", layoutMode: "floating_hud", isAskOpen: false });
  });

  it("the screen is off for picked options by default and can be turned on", () => {
    render(<LiveOptions />);
    const toggle = screen.getByRole("button", { name: "Include screen" });

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(state().optionsUseScreen).toBe(true);
    expect(state().askUsesScreen).toBe(true);
  });

  it("Assist starts a new assist thread with the screen", () => {
    render(<LiveOptions />);
    const listener = vi.fn();
    window.addEventListener("sidekick:deep_solve", listener);

    fireEvent.click(screen.getByRole("button", { name: /Assist/ }));

    window.removeEventListener("sidekick:deep_solve", listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      kind: "assist",
      newThread: true,
      captureWindow: true,
    });
  });
});

describe("answer panel follows new content only near the bottom", () => {
  beforeEach(() => {
    state().clearSession();
    useAppStore.setState({ isAskOpen: false });
  });

  it("scrolls to the latest message unless the user has scrolled up", () => {
    const first = state().beginMessage({ question: "Long chat", kind: "typed", newThread: true })!;
    state().updateMessage(first.threadId, first.messageId, {
      solution: { stage1Intuition: { verbalSummary: "Hi.", keyTradeoffs: [] }, stage2Code: null, stage3Analysis: null },
    });
    render(<AnswerPanel />);

    const body = document.querySelector<HTMLElement>(".sk-scroll")!;
    const scrollTo = vi.fn();
    let scrollTop = 0;
    Object.defineProperties(body, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
      scrollTop: { get: () => scrollTop, set: (v: number) => (scrollTop = v), configurable: true },
    });
    body.scrollTo = scrollTo;

    // Scrolled up: a new message doesn't pull the view down
    fireEvent.scroll(body);
    scrollTo.mockClear();
    act(() => {
      state().beginMessage({ question: "Follow-up", kind: "typed", newThread: false });
    });
    expect(scrollTo).not.toHaveBeenCalled();

    // Back at the bottom: the next update follows the latest message
    scrollTop = 800;
    fireEvent.scroll(body);
    act(() => {
      state().beginMessage({ question: "Newest", kind: "typed", newThread: false });
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("scrolling up with ⇧⌘↑ stops the view following a streaming answer", async () => {
    const first = state().beginMessage({ question: "Long answer", kind: "typed", newThread: true })!;
    render(<AnswerPanel />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://scroll_answer")).toBe(true));

    const body = document.querySelector<HTMLElement>(".sk-scroll")!;
    const scrollTo = vi.fn();
    Object.defineProperties(body, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
      scrollTop: { value: 800, configurable: true },
    });
    body.scrollTo = scrollTo;
    body.scrollBy = vi.fn();
    fireEvent.scroll(body); // at the bottom: following

    act(() => tauri.handlers.get("sidekick://scroll_answer")!({ payload: { direction: "up" } }));
    scrollTo.mockClear();
    act(() => {
      state().updateMessage(first.threadId, first.messageId, {
        solution: { stage1Intuition: { verbalSummary: "Streaming.", keyTradeoffs: [] }, stage2Code: null, stage3Analysis: null },
      });
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("⇧⌘↑/↓ stop at the ends of the answer", () => {
  beforeEach(() => {
    state().clearSession();
    useAppStore.setState({ isAskOpen: false });
  });

  it("does nothing past an end, and scrolls by only the room left before it", async () => {
    state().beginMessage({ question: "Long answer", kind: "typed", newThread: true });
    render(<AnswerPanel />);
    await vi.waitFor(() => expect(tauri.handlers.has("sidekick://scroll_answer")).toBe(true));

    const body = document.querySelector<HTMLElement>(".sk-scroll")!;
    const scrollBy = vi.fn();
    let scrollTop = 800;
    Object.defineProperties(body, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
      scrollTop: { get: () => scrollTop, configurable: true },
    });
    body.scrollBy = scrollBy;
    const press = (direction: "up" | "down") =>
      act(() => tauri.handlers.get("sidekick://scroll_answer")!({ payload: { direction } }));

    // At the bottom: nothing to scroll
    press("down");
    expect(scrollBy).not.toHaveBeenCalled();

    // 20px short of the bottom: scrolls exactly that far, not a third of the view
    scrollTop = 780;
    press("down");
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ top: 20 }));

    // At the top: nothing to scroll up
    scrollTop = 0;
    press("up");
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});

describe("answer header and Ask box", () => {
  beforeEach(() => {
    state().clearSession();
    useAppStore.setState({ isAskOpen: false });
    useSessionStore.setState({ askDraft: "" });
  });

  it("the header has no question: New chat and History on the left, Close on the right, every question once in the list", () => {
    const first = state().beginMessage({ question: "First question", kind: "typed", newThread: true })!;
    state().updateMessage(first.threadId, first.messageId, { viewedScreen: true });
    state().beginMessage({ question: "Second question", kind: "typed", newThread: false });
    render(<AnswerPanel />);

    // Close sits in the header's Tip wrapper, so its header is two levels up
    const header = screen.getByRole("button", { name: "Close" }).parentElement!.parentElement!;
    expect(header.textContent).not.toContain("First question");
    expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "New chat",
      "History",
      "Close",
    ]);
    expect(screen.getAllByText("First question")).toHaveLength(1);
    expect(screen.getAllByText("Second question")).toHaveLength(1);
    expect(screen.getByText("Viewed screen")).toBeDefined();
  });

  it("showing Sidekick opens the Ask box and leaves focus alone", async () => {
    await setupAppEventListeners();
    render(<AnswerPanel />);
    expect(screen.queryByLabelText("Ask a follow-up")).toBeNull();

    act(() => tauri.handlers.get("sidekick://visibility_toggled")!({ payload: { visible: true } }));

    const input = screen.getByLabelText("Ask a follow-up");
    expect(useAppStore.getState().isAskOpen).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it("the Ask button opens the box and focuses it", () => {
    render(
      <>
        <ControlBar />
        <AnswerPanel />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));

    expect(document.activeElement).toBe(screen.getByLabelText("Ask a follow-up"));
  });

  it("a panel that mounts again does not refocus an Ask request it already handled", () => {
    const { unmount } = render(
      <>
        <ControlBar />
        <AnswerPanel />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
    unmount();

    render(<AnswerPanel />);

    expect(document.activeElement).not.toBe(screen.getByLabelText("Ask a follow-up"));
  });

  it("an Ask request made while the panel was unmounted focuses the box when it mounts", () => {
    // Settings or compact view hide the panel; Ask shows it again in the same update
    act(() => useAppStore.setState((s) => ({ isAskOpen: true, askFocusRequest: s.askFocusRequest + 1 })));
    render(<AnswerPanel />);

    expect(document.activeElement).toBe(screen.getByLabelText("Ask a follow-up"));
  });

  it("the hint shows ⌘↵ Assist for an empty draft and ↵ Send once there is text", () => {
    useAppStore.setState({ isAskOpen: true });
    render(<AnswerPanel />);
    const input = screen.getByLabelText("Ask a follow-up");
    const hint = () => input.nextElementSibling!.textContent;

    expect(screen.getByPlaceholderText("Ask about your screen or type a question…")).toBe(input);
    expect(hint()).toBe("⌘↵Assist");

    fireEvent.change(input, { target: { value: "   " } });
    expect(hint()).toBe("⌘↵Assist");

    fireEvent.change(input, { target: { value: "Why?" } });
    expect(hint()).toBe("↵Send");
  });

  it("with a thread, the placeholder asks a follow-up", () => {
    state().beginMessage({ question: "A chat", kind: "typed", newThread: true });
    render(<AnswerPanel />);

    expect(screen.getByPlaceholderText("Ask a follow-up…")).toBeDefined();
  });
});
