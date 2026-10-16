import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePointerHover } from "./usePointerHover";

// Stands in for the Tauri event bus, so the test can send sidekick://pointer the way Rust does
const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    events.set(name, handler);
    return () => events.delete(name);
  }),
}));

// happy-dom does no hit testing, so each test says what sits under the pointer
let under: Element | null = null;

const marked = () => Array.from(document.querySelectorAll("[data-hover]"), (el) => el.id || el.localName);
const report = (inside: boolean, x = 0, y = 0) => events.get("sidekick://pointer")!({ payload: { inside, x, y } });
const mountHook = async () => {
  renderHook(() => usePointerHover());
  await vi.waitFor(() => expect(events.has("sidekick://pointer")).toBe(true));
};

describe("usePointerHover", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main id="page"><section id="panel"><button id="btn">Close</button></section></main><p id="text">Answer</p>`;
    under = null;
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => under);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the element under the pointer and its ancestors, and moves the marks with it", async () => {
    await mountHook();

    under = document.getElementById("btn");
    report(true, 10, 20);
    expect(document.elementFromPoint).toHaveBeenCalledWith(10, 20);
    expect(marked()).toEqual(["html", "body", "page", "panel", "btn"]);

    under = document.getElementById("text");
    report(true, 30, 40);
    expect(marked()).toEqual(["html", "body", "text"]);
  });

  it("clears every mark when the pointer is reported outside the UI", async () => {
    await mountHook();

    under = document.getElementById("btn");
    report(true, 10, 20);
    report(false);
    expect(marked()).toEqual([]);
  });

  it("clears the marks when the pointer leaves the page, but not when the window blurs", async () => {
    await mountHook();

    under = document.getElementById("btn");
    report(true, 10, 20);
    document.documentElement.dispatchEvent(new Event("pointerleave"));
    expect(marked()).toEqual([]);

    // Handing focus back blurs the window while the pointer is still over the UI
    report(true, 10, 20);
    window.dispatchEvent(new Event("blur"));
    expect(marked()).not.toEqual([]);
  });

  it("follows real pointer moves where WebKit delivers them", async () => {
    await mountHook();

    under = document.getElementById("btn");
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 6 }));
    expect(document.elementFromPoint).toHaveBeenCalledWith(5, 6);
    expect(marked()).toEqual(["html", "body", "page", "panel", "btn"]);
  });

  it("leaves the DOM alone while the hovered chain is unchanged", async () => {
    await mountHook();

    under = document.getElementById("btn");
    report(true, 10, 20);
    const setAttribute = vi.spyOn(document.getElementById("btn")!, "setAttribute");
    report(true, 10.2, 20.2);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("clears its marks and stops listening on unmount", async () => {
    const { unmount } = renderHook(() => usePointerHover());
    await vi.waitFor(() => expect(events.has("sidekick://pointer")).toBe(true));

    under = document.getElementById("btn");
    report(true, 10, 20);
    unmount();
    expect(marked()).toEqual([]);
    expect(events.has("sidekick://pointer")).toBe(false);
  });
});
