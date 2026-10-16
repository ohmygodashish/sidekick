import { useEffect, useState } from "react";

// Matches .sk-pop[data-state="closed"] in index.css
export const EXIT_MS = 120;

/**
 * Keeps an element mounted for its exit transition. Render while `mounted`, and put
 * `data-state={state}` on an `.sk-pop` element so it plays out before unmounting.
 */
export function usePresence(open: boolean) {
  const [lingering, setLingering] = useState(open);

  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const id = setTimeout(() => setLingering(false), EXIT_MS);
    return () => clearTimeout(id);
  }, [open]);

  return { mounted: open || lingering, state: open ? ("open" as const) : ("closed" as const) };
}
