# 002 — Theme switch changes everything in one step

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 2 files + 1 test, ~20 lines

## Problem

`src/hooks/useTheme.ts` sets `document.documentElement.dataset.theme`. Every colour comes from `--sk-*` variables, so plain elements snap to the new theme in one frame, but elements with `transition-colors duration-150` (buttons, tabs, menu items, `.sk-field` etc.) fade over 150 ms. The window repaints in two visible steps.

```ts
// src/hooks/useTheme.ts — current
useLayoutEffect(() => {
  const root = document.documentElement;
  if (theme !== "system") {
    root.dataset.theme = theme;
    return;
  }
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  const apply = () => (root.dataset.theme = media?.matches ? "light" : "dark");
  apply();
  media?.addEventListener("change", apply);
  return () => media?.removeEventListener("change", apply);
}, [theme]);
```

## Target

While `data-theme` changes, all transitions are off for two frames, so every element takes the new colours in the same frame. The first application on launch is unaffected (nothing to transition from).

```css
/* src/index.css — add next to the Motion section */
/* Theme changes land in one frame: transitions are off while data-theme changes (useTheme) */
:root[data-theme-switching] *,
:root[data-theme-switching] *::before,
:root[data-theme-switching] *::after {
  transition: none !important;
}
```

## Steps

1. Add the CSS block above to `src/index.css`, directly after the `.sk-menu.sk-pop` rule and before the `@media (prefers-reduced-motion: reduce)` block.
2. In `useTheme.ts`, add a module-level helper and use it for every assignment of `root.dataset.theme` (the fixed-theme branch and `apply`):
   ```ts
   /** Sets data-theme with transitions off for two frames, so every colour changes in the same frame */
   function setTheme(root: HTMLElement, next: string) {
     if (root.dataset.theme === next) return;
     const first = root.dataset.theme === undefined;
     if (!first) root.dataset.themeSwitching = "";
     root.dataset.theme = next;
     if (!first) requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
   }
   ```
   Keep the `useLayoutEffect` and the media listener exactly as they are otherwise.
3. Test (new `src/__tests__/useTheme.test.ts` or the existing theme test if one exists — grep `useTheme`): render a component calling `useTheme`, change `theme` in `useSettingsStore` from "dark" to "light", assert `document.documentElement.dataset.themeSwitching` is `""` right after, and `undefined` after two `requestAnimationFrame` ticks (use `vi.useFakeTimers({ toFake: ["requestAnimationFrame"] })` + `vi.advanceTimersToNextFrame()` twice, or stub rAF to run callbacks synchronously after the assertion).

## Boundaries

- Only `src/hooks/useTheme.ts`, `src/index.css` and the test. No colour token changes.
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`; `npx vitest run`.
- **Feel check**: Settings → General → Appearance, click Light/Dark/System repeatedly: the whole window (pill, panel, buttons, fields, tabs) flips in one frame — no buttons lagging behind the background. Hover colours still fade normally afterwards.
- **Done when**: no element visibly finishes its theme change after the others.
