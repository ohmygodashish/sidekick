# 005 — Segmented controls get a sliding thumb (and the theme control reuses Segmented)

- **Status**: DONE
- **Commit**: 6946b7c
- **Severity**: LOW
- **Category**: Missed opportunities
- **Estimated scope**: 1 new file, 2 edited files, tests; net small (removes duplicated theme radiogroup code)

## Problem

Three segmented radiogroups paint the selection as a background on the chosen button, so it jumps between segments:
- `Segmented` in `src/components/settings/ApiKeyInputs.tsx:30-82` (solution provider, thinking level), `className="grid grid-cols-3 gap-1 rounded-lg bg-sk-fill-2 p-1"`, selected button `bg-sk-accent-tint text-sk-fg`, others `text-sk-fg-2 hover:bg-sk-hover`.
- The theme radiogroup in `src/components/settings/SettingsDrawer.tsx` (Appearance at the top of the General tab; `THEMES`, `themeRefs`, `onThemeKeyDown`, buttons with an icon + label), container `grid grid-cols-3 gap-1 rounded-lg bg-sk-fill p-1`, unselected `bg-sk-fill text-sk-fg-2 hover:bg-sk-hover`.

## Target

One `Segmented` component in its own file with a thumb (`bg-sk-accent-tint`) that slides to the selected segment: `transform` only, 200 ms, `var(--sk-ease)` (`cubic-bezier(0.23, 1, 0.32, 1)`), no transition under reduced motion. Buttons have transparent backgrounds and sit above the thumb.

## Steps

1. Create `src/components/settings/Segmented.tsx` by moving `Segmented` (and `SegmentedProps`) out of ApiKeyInputs.tsx, exported. Extend options to `{ id: T; label: string; icon?: LucideIcon }[]` and add an optional `className` for the container background (default `"bg-sk-fill-2"`). Render:
   ```tsx
   const index = Math.max(0, options.findIndex((o) => o.id === value));
   const n = options.length;
   <div role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}
        className={cn("relative grid gap-1 rounded-lg p-1", className)}
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
     {/* The selection thumb slides between segments; p-1 = 0.25rem inset, gap-1 = 0.25rem */}
     <span aria-hidden="true"
       className="absolute bottom-1 left-1 top-1 rounded bg-sk-accent-tint transition-transform duration-200 motion-reduce:transition-none"
       style={{
         width: `calc((100% - 0.5rem - ${n - 1} * 0.25rem) / ${n})`,
         transform: `translateX(calc(${index} * (100% + 0.25rem)))`,
         transitionTimingFunction: "var(--sk-ease)",
       }} />
     {options.map(({ id, label, icon: Icon }) => /* button as today, plus: */ (
       // className: "relative flex h-7 items-center justify-center gap-1.5 rounded text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
       //            selected ? "text-sk-fg" : "text-sk-fg-2 hover:bg-sk-hover"
       // children: {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}<span>{label}</span>
     ))}
   </div>
   ```
   Keep the arrow-key handler and roving `tabIndex` exactly as they are (its `.focus()` runs only on a user key press — allowed).
2. `ApiKeyInputs.tsx`: import `Segmented` from `./Segmented`; delete the local copy. Usage unchanged.
3. `SettingsDrawer.tsx`: replace the theme radiogroup with
   `<Segmented labelledBy="appearance-label" options={THEMES} value={theme} onChange={setTheme} className="bg-sk-fill" />`, give the Appearance `<h3>` `id="appearance-label"`, and delete `themeRefs` and `onThemeKeyDown`. Keep the "System follows your macOS appearance." line. Keep the theme buttons' height (`h-8` was used there; use `h-7` from Segmented — acceptable) . NOTE: the radiogroup was named via `aria-label="Theme"`; it is now named by the "Appearance" heading — update tests that query `getByRole("radiogroup", { name: "Theme" })` to `{ name: "Appearance" }`.
4. Tests: existing provider/level/theme tests must still pass after the name update. Add one test in `src/__tests__/SettingsDrawer.test.tsx`: the thumb (`[role=radiogroup] > span[aria-hidden]`) for the theme group has `transform` containing `translateX(calc(2 * ` when theme is "dark" (THEMES order is system, light, dark).

## Boundaries

- Only `Segmented.tsx` (new), `ApiKeyInputs.tsx`, `SettingsDrawer.tsx`, `src/__tests__/SettingsDrawer.test.tsx`. Do NOT touch `src/index.css`.
- No new dependencies; no layout animation (only the thumb's transform animates).
- If a step doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`; `npx vitest run`; `npm run build`.
- **Feel check**: click Anthropic → OpenRouter: the tint glides two segments in ~200 ms and settles without overshoot; arrow keys move it too; rapid clicks retarget mid-slide (no restart). Light/dark themes: thumb visible on both container backgrounds. Reduce motion: the thumb jumps.
- **Done when**: all three controls slide and the theme control no longer has its own radiogroup code.
