# 001 — Exit animations for the Settings and answer panels

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: MEDIUM
- **Category**: Missed opportunities / Interruptibility
- **Estimated scope**: 3 files + tests, ~40 lines

## Problem

Both big panels enter with `.sk-pop` (fade + 4px drop via `@starting-style`) but vanish in one frame when closed.

```tsx
// src/components/hud/HUDContainer.tsx:63 — current
{isSettingsOpen ? (
  <SettingsDrawer />
) : layoutMode === "dynamic_notch" ? null : (
  <AnswerPanel />
)}
```

```tsx
// src/components/settings/SettingsDrawer.tsx:157 — current (drawer reads isOpen from the store when no prop)
if (!isOpen) {
  return null;
}
```

```tsx
// src/components/answer/AnswerPanel.tsx:140 — current
if (!thread && !isAskOpen) return null;
```

## Target

Closing either panel plays the existing `.sk-pop[data-state="closed"]` exit (120 ms, `opacity 0`, `translateY(-4px) scale(0.98)`, `var(--sk-ease)` = `cubic-bezier(0.23, 1, 0.32, 1)`), with its content still on screen during the exit, then unmounts. Under `prefers-reduced-motion` the existing CSS already drops the transform and keeps the fade.

## Repo conventions to follow

- `usePresence(open)` in `src/hooks/usePresence.ts` returns `{ mounted, state }`; render while `mounted`, put `data-state={state}` and `inert={state === "closed"}` on the `.sk-pop` element. Exemplar: `src/components/hud/LiveOptions.tsx:24-36`.
- The exit length is `EXIT_MS = 120` in `usePresence.ts`, matching the CSS. Do not change either.

## Steps

1. `SettingsDrawer.tsx`: add an optional prop `state?: "open" | "closed"` to `SettingsDrawerProps` (doc comment: "closed while the drawer plays its exit"). On the root `<section>` add `data-state={state}` and `inert={state === "closed"}`. Nothing else changes.
2. `HUDContainer.tsx`: `const settings = usePresence(isSettingsOpen);` (usePresence is already imported there). Replace the condition with `settings.mounted ? <SettingsDrawer isOpen state={settings.state} /> : layoutMode === "dynamic_notch" ? null : <AnswerPanel />`. Passing `isOpen` keeps the drawer rendered during its exit (it otherwise reads `false` from the store and returns null). The answer panel appears after the 120 ms exit, which is intended.
3. `AnswerPanel.tsx`: before the early return (all hooks must stay above it), add
   ```tsx
   const visible = Boolean(thread) || isAskOpen;
   const presence = usePresence(visible);
   // Closing keeps the last thread on screen while the panel plays its exit
   const lastThread = useRef(thread);
   if (thread) lastThread.current = thread;
   ```
   Replace `if (!thread && !isAskOpen) return null;` with `if (!presence.mounted) return null;` and compute `const shown = visible ? thread : lastThread.current;` — use `shown` wherever the render reads `thread` (messages, the New chat `disabled`, the placeholder). Keep `thread` (not `shown`) for anything that acts (startNewChat etc.). On the `<section className="sk-panel sk-pop min-h-0">` add `data-state={presence.state}` and `inert={presence.state === "closed"}`.
   Note: ⌘R New chat sets thread to null while Ask stays open, so `visible` stays true and the panel empties at once — correct, do not animate that.
4. Tests: in `src/__tests__/SettingsDrawer.test.tsx` add one test that `<SettingsDrawer isOpen state="closed" />` renders the dialog with `data-state="closed"` and the `inert` attribute. If an AnswerPanel test file exists (`src/__tests__/*Answer*`), add one test: open with a thread, close (clear the answer and Ask), and the section is still present with `data-state="closed"` immediately after, then gone after `vi.advanceTimersByTime(120)` under fake timers.

## Boundaries

- Do NOT touch `src/index.css`, `usePresence.ts`, or any other component.
- Do NOT add `.focus()` calls anywhere. Do NOT change the drawer's existing focus-the-tab-on-open effect.
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit` clean; `npx vitest run` all pass.
- **Feel check**: open Settings with ⌘, then close with Esc and with the X: the drawer fades and lifts 4px over ~120 ms with its content intact, then the answer panel (if any) pops in. Close an answer with its X: same exit, the text stays readable while fading. ⌘R New chat empties the panel instantly (no exit).
- **Done when**: neither panel disappears in a single frame on close.
