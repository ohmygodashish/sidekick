import { useEffect, type RefObject } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

// Every visible piece of UI is one of these surfaces; everything else is see-through
const SURFACES = ".sk-bar, .sk-panel, .sk-menu, .sk-surface";

/**
 * Reports where the visible UI under `ref` is, so Rust lets the mouse through everywhere
 * else (see `hit_region.rs`).
 */
export function useHitRegions(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !isTauri()) return;

    let last = "";

    const measure = () => {
      const rects: number[][] = [];
      for (const piece of Array.from(el.querySelectorAll(SURFACES))) {
        resizeObserver.observe(piece); // no-op if already observed
        const r = piece.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rects.push([r.x, r.y, r.width, r.height].map(Math.round));
      }
      const key = JSON.stringify(rects);
      if (key === last) return;
      last = key;
      invoke("set_hit_regions", { rects }).catch((err) =>
        console.warn("[useHitRegions] set_hit_regions failed:", err)
      );
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    // Pieces mount, unmount and animate without the root's box changing
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(el, { childList: true, subtree: true });
    el.addEventListener("animationend", measure);
    el.addEventListener("transitionend", measure);
    measure();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      el.removeEventListener("animationend", measure);
      el.removeEventListener("transitionend", measure);
    };
  }, [ref]);
}
