# 003 — Real cross-fade when a live option's text changes

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens (crossfade)
- **Estimated scope**: 2 files + tests, ~35 lines

## Problem

```tsx
// src/components/hud/LiveOptions.tsx:59 — current
{/* Keyed by text so a changed option fades in instead of snapping */}
<span key={option.text} className="sk-fade min-w-0 flex-1">
  {option.text}
</span>
```

Re-keying unmounts the old text in one frame and fades only the new text in, so the old question blinks out. Options change after every transcript turn, so this happens many times per meeting.

## Target

Old and new text sit in the same grid cell. The old text fades out over 120 ms with a 2px blur (masks the double exposure); the new text fades in over 150 ms (`.sk-fade`, unchanged). Only opacity and filter animate; blur stays ≤ 2px.

```css
/* src/index.css — add next to .sk-fade */
/* .sk-fade-out: the outgoing text of a cross-fade; mounted already visible, then fades and blurs away */
.sk-fade-out {
  opacity: 0;
  filter: blur(2px);
  transition:
    opacity 120ms var(--sk-ease),
    filter 120ms var(--sk-ease);
}
```
and inside the existing top-level `@starting-style { … }` block add:
```css
  .sk-fade-out {
    opacity: 1;
    filter: none;
  }
```

## Steps

1. Add the CSS above to `src/index.css` (`.sk-fade-out` rule right after `.sk-fade`; the starting-style entry inside the existing `@starting-style` block that holds `.sk-pop`/`.sk-fade`). Extend the Motion comment block above `.sk-pop` with one line: ` * .sk-fade-out: the outgoing text of a cross-fade (FadeText in LiveOptions).`
2. In `src/components/hud/LiveOptions.tsx`, add a small local component and import `EXIT_MS` from `../../hooks/usePresence`:
   ```tsx
   /** Option text that cross-fades: the old text fades out on top of the new one fading in */
   const FadeText: React.FC<{ text: string }> = ({ text }) => {
     const [old, setOld] = useState<string | null>(null);
     const last = useRef(text);
     useEffect(() => {
       if (last.current === text) return;
       setOld(last.current);
       last.current = text;
       const id = setTimeout(() => setOld(null), EXIT_MS);
       return () => clearTimeout(id);
     }, [text]);
     return (
       <span className="grid min-w-0 flex-1">
         {old !== null && (
           <span key={old} aria-hidden="true" className="sk-fade-out col-start-1 row-start-1">
             {old}
           </span>
         )}
         <span key={text} className="sk-fade col-start-1 row-start-1">
           {text}
         </span>
       </span>
     );
   };
   ```
   Replace the keyed `<span key={option.text} …>` (and its comment) with `<FadeText text={option.text} />`. The `<button>` keeps `key={i}` so each slot is stable.
3. Tests in the existing live-options test file (`src/__tests__/liveOptions.test.tsx` or the LiveOptions component test — grep `live-options`): with fake timers, render options, change slot 1's text; assert the old text is present with `aria-hidden="true"` and the new text present; after `vi.advanceTimersByTime(120)` the old text is gone. Also assert the button's accessible name is just the new text (old is aria-hidden).

## Boundaries

- Only `src/components/hud/LiveOptions.tsx`, `src/index.css` and the test.
- Do NOT add blur above 2px. Do NOT animate layout (height/width).
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`; `npx vitest run`.
- **Feel check**: during a meeting, watch an option change: the old question softens and fades while the new one fades in, no blink. Slow it down (Web Inspector → Animations at 10%) and confirm the overlap is short and the blur is subtle.
- **Done when**: changed options never blink out.
