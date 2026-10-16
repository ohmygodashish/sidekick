import { describe, it, expect, afterEach } from "vitest";
import { shouldReleaseFocus } from "./useFocusRelease";

describe("shouldReleaseFocus", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("keeps focus while text is selected, so copying still works", () => {
    document.body.innerHTML = `<p>Answer text</p><button>Copy</button>`;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    document.getSelection()!.addRange(range);
    document.querySelector("button")!.focus();
    expect(shouldReleaseFocus(document, false)).toBe(false);
  });

  it("keeps focus while a text field has it", () => {
    document.body.innerHTML = `<input aria-label="Ask" />`;
    document.querySelector("input")!.focus();
    expect(shouldReleaseFocus(document, false)).toBe(false);
  });

  it("keeps focus while a menu is open", () => {
    document.body.innerHTML = `<button>Mode</button><div role="menu"><button>General</button></div>`;
    document.querySelector("button")!.focus();
    expect(shouldReleaseFocus(document, false)).toBe(false);
  });

  it("keeps focus while settings are open", () => {
    document.body.innerHTML = `<button>Keys</button>`;
    document.querySelector("button")!.focus();
    expect(shouldReleaseFocus(document, true)).toBe(false);
  });

  it("releases focus while a closing menu is still mounted for its exit animation", () => {
    document.body.innerHTML = `<button>Mode</button><div role="menu" data-state="closed"></div>`;
    document.querySelector("button")!.focus();
    expect(shouldReleaseFocus(document, false)).toBe(true);
  });

  it("releases focus when a button has it and nothing else is open", () => {
    document.body.innerHTML = `<button>Hide</button>`;
    document.querySelector("button")!.focus();
    expect(shouldReleaseFocus(document, false)).toBe(true);
  });
});
