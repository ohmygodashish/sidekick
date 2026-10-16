# 006 — Warm tooltips: after the first one, neighbours show instantly

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: LOW
- **Category**: Purpose & frequency
- **Estimated scope**: 2 files + test, ~25 lines

## Problem

```css
/* src/index.css — current */
.sk-tip-host > .sk-tip { … opacity: 0; transition: opacity 120ms var(--sk-ease) 0ms; }
.sk-tip-host[data-hover] > .sk-tip,
.sk-tip-host:has(:focus-visible) > .sk-tip { opacity: 1; transition-delay: 400ms; }
```
Every tooltip waits 400 ms, even when the user is sliding along the pill reading them one after another. Hover is driven by `data-hover` attributes (set on the element under the pointer and all its ancestors by `src/hooks/usePointerHover.ts`), not `:hover`.

## Target

Once a tooltip has fully appeared, its surface (the nearest `.sk-surface` or `.sk-panel` ancestor — the pill, the options card, the answer panel) becomes "warm": while the pointer stays on that surface, other tooltips in it appear and disappear instantly (0 ms delay, 0 ms duration). Leaving the surface cools it.

```css
/* src/index.css — add after the existing .sk-tip rules (inside the same @layer components block) */
/* Warm: a tip in this surface has shown and the pointer is still on it, so neighbours switch instantly */
.sk-tips-warm[data-hover] .sk-tip-host > .sk-tip {
  transition-duration: 0ms;
  transition-delay: 0ms;
}
```

## Steps

1. Add the CSS above.
2. `src/components/hud/Tip.tsx`: on the tooltip `<span role="tooltip" className="sk-tip">` add
   ```tsx
   onTransitionEnd={(e) => {
     const surface = e.currentTarget.closest(".sk-surface, .sk-panel");
     if (!surface) return;
     // Shown: warm the surface. Hidden after the pointer left the surface: cool it
     if (getComputedStyle(e.currentTarget).opacity === "1") surface.classList.add("sk-tips-warm");
     else if (!surface.hasAttribute("data-hover")) surface.classList.remove("sk-tips-warm");
   }}
   ```
   Update the Tip doc comment with one sentence: "Once one tip has shown, the others in the same surface show instantly while the pointer stays on it (`.sk-tips-warm`)."
3. A tip that hides with a 0 ms transition fires no `transitionend`, so cooling can't rely on step 2 alone. In `src/hooks/usePointerHover.ts`, inside `mark()`'s existing unmark loop, also remove the class when an element loses `data-hover`:
   ```ts
   for (const el of marked)
     if (!chain.includes(el)) {
       el.removeAttribute("data-hover");
       // Leaving a surface cools its tooltips (Tip.tsx)
       el.classList.remove("sk-tips-warm");
     }
   ```
4. Test (new `src/__tests__/Tip.test.tsx` or an existing Tip test): render two `<Tip>`s inside `<div className="sk-surface" data-hover>`; fire `transitionEnd` on the first tooltip with `getComputedStyle` opacity "1" (stub `window.getComputedStyle` for that element) and assert the surface has `sk-tips-warm`. Add a usePointerHover-level assertion if a test for it exists (grep `usePointerHover`): unmarking removes `sk-tips-warm`.

## Boundaries

- Only `src/index.css`, `src/components/hud/Tip.tsx`, `src/hooks/usePointerHover.ts` and tests. Tips must stay non-interactive (`pointer-events: none`), never focusable.
- Keyboard focus tips (`:has(:focus-visible)`) keep their 400 ms delay unless the surface is warm.
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`; `npx vitest run`.
- **Feel check**: hover Ask on the pill, wait for its tip, slide to Hide and the … button: their tips appear immediately and the previous one disappears immediately. Move off the pill, come back: the first tip waits 400 ms again.
- **Done when**: the above holds in the real window (hover comes from the Rust pointer poller there).
