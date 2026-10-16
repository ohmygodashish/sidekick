import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Tip } from "../components/hud/Tip";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tip", () => {
  it("warms its surface once a tip has shown, and cools it when a tip hides after the pointer left", () => {
    const { container } = render(
      <div className="sk-surface" data-hover>
        <Tip label="Ask">
          <button type="button">Ask</button>
        </Tip>
        <Tip label="Hide">
          <button type="button">Hide</button>
        </Tip>
      </div>
    );
    const surface = container.querySelector<HTMLElement>(".sk-surface")!;
    const [ask] = Array.from(container.querySelectorAll<HTMLElement>(".sk-tip"));

    vi.spyOn(window, "getComputedStyle").mockReturnValue({ opacity: "1" } as CSSStyleDeclaration);
    fireEvent.transitionEnd(ask);
    expect(surface.classList.contains("sk-tips-warm")).toBe(true);

    // The pointer is still on the surface: a tip hiding keeps it warm
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ opacity: "0" } as CSSStyleDeclaration);
    fireEvent.transitionEnd(ask);
    expect(surface.classList.contains("sk-tips-warm")).toBe(true);

    // The pointer has left the surface: a tip hiding cools it
    surface.removeAttribute("data-hover");
    fireEvent.transitionEnd(ask);
    expect(surface.classList.contains("sk-tips-warm")).toBe(false);
  });

  it("warms the pill (.sk-bar), but not from a keyboard-focus tip", () => {
    const { container } = render(
      <div className="sk-bar">
        <Tip label="Ask">
          <button type="button">Ask</button>
        </Tip>
      </div>
    );
    const bar = container.querySelector<HTMLElement>(".sk-bar")!;
    const tip = container.querySelector<HTMLElement>(".sk-tip")!;
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ opacity: "1" } as CSSStyleDeclaration);

    // Shown by keyboard focus: the pointer isn't on the pill
    fireEvent.transitionEnd(tip);
    expect(bar.classList.contains("sk-tips-warm")).toBe(false);

    bar.setAttribute("data-hover", "");
    fireEvent.transitionEnd(tip);
    expect(bar.classList.contains("sk-tips-warm")).toBe(true);
  });
});
