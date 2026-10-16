import { useEffect } from "react";

interface PointerReport {
  inside: boolean;
  x: number;
  y: number;
}

/**
 * Marks the element under the pointer and its ancestors with data-hover, so the hover styles (the
 * `hover:` variant in tailwind.config.js) follow the pointer the way :hover would. WebKit gets no
 * mouse moves while the overlay isn't key, so Rust reports the pointer (sidekick://pointer); real
 * pointer events update the marks too, wherever WebKit sends them.
 */
export function usePointerHover() {
  useEffect(() => {
    let marked: Element[] = [];

    // Marks the chain from `target` up to <html> and unmarks what is no longer under the pointer
    const mark = (target: Element | null) => {
      const chain: Element[] = [];
      for (let el = target; el; el = el.parentElement) chain.push(el);
      if (chain.length === marked.length && chain.every((el, i) => el === marked[i])) return;
      for (const el of marked) if (!chain.includes(el)) el.removeAttribute("data-hover");
      for (const el of chain) el.setAttribute("data-hover", "");
      marked = chain;
    };
    const clear = () => mark(null);

    const onPointer = (event: { payload: PointerReport }) => {
      const { inside, x, y } = event.payload;
      if (inside) mark(document.elementFromPoint(x, y));
      else clear();
    };
    const onPointerMove = (event: PointerEvent) => mark(document.elementFromPoint(event.clientX, event.clientY));

    const root = document.documentElement;
    window.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", clear);

    // StrictMode mounts twice in dev; drop a listener that resolves after cleanup
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<PointerReport>("sidekick://pointer", onPointer))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", clear);
      clear();
    };
  }, []);
}
