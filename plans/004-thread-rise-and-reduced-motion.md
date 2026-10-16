# 004 — New thread messages rise in; spinner and chevron respect Reduce Motion

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: LOW
- **Category**: Missed opportunities / Accessibility
- **Estimated scope**: 3 files, ~15 lines

## Problem

```tsx
// src/components/answer/AnswerPanel.tsx:29 — current
<div className="sk-fade space-y-3">
```
New exchanges in a thread only fade; the plan calls for a fade with a 4px rise.

```tsx
// LoaderCircle with "animate-spin": AnswerPanel.tsx:54, ControlBar.tsx:53, SettingsDrawer.tsx (download), — current
<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
```
```tsx
// src/components/cards/ProgressiveCard.tsx:43 — current
"ml-auto h-3.5 w-3.5 shrink-0 text-sk-fg-3 transition-transform duration-150",
```
Under `prefers-reduced-motion: reduce` the spinner keeps spinning and the chevron keeps rotating.

## Target

```css
/* src/index.css — add after .sk-fade */
/* .sk-rise: a new message in a thread: fades in while rising 4px */
.sk-rise {
  transition:
    opacity 160ms var(--sk-ease),
    transform 160ms var(--sk-ease);
}
```
Inside the existing top-level `@starting-style` block:
```css
  .sk-rise {
    opacity: 0;
    transform: translateY(4px);
  }
```
Inside the existing `@media (prefers-reduced-motion: reduce)` block (both the plain rules and its nested `@starting-style`):
```css
  /* A still spinner: the "Thinking…" text says the same */
  .animate-spin {
    animation: none;
  }
```
and in its nested `@starting-style { … }` add `.sk-rise { transform: none; }` next to `.sk-pop`.

## Steps

1. (CSS owner) Add the three CSS pieces above to `src/index.css`, and add ` * .sk-rise: a new message in a thread; fades in rising 4px.` to the Motion comment block.
2. `AnswerPanel.tsx:29`: change the Exchange root class from `sk-fade space-y-3` to `sk-rise space-y-3`.
3. `ProgressiveCard.tsx:43`: append ` motion-reduce:transition-none` to the chevron class string.

## Boundaries

- Only these three files. No new spinner component; no JS reduced-motion checks.
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`; `npx vitest run`; `npm run build` (Tailwind must emit `motion-reduce:transition-none`).
- **Feel check**: ask a follow-up in a thread — the new exchange fades in rising 4px. Turn on System Settings → Accessibility → Display → Reduce motion: the new exchange only fades, the spinner is still, the Code/Complexity chevrons flip without rotating.
- **Done when**: both checks above hold.
