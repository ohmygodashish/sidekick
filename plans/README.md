# Animation plans (Phase 6 — motion)

Written by the `improve-animations` audit at commit 6946b7c. Plans 001–004 are the Motion row of `docs/cluely-parity-plan.md`; 005–006 are extras the user picked.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Exit animations for the Settings and answer panels](001-panel-exits.md) | MEDIUM | DONE |
| 002 | [Theme switch in one step](002-theme-one-step.md) | MEDIUM | DONE |
| 003 | [Real cross-fade for live option text](003-option-crossfade.md) | MEDIUM | DONE |
| 004 | [Thread messages rise in; spinner and chevron respect Reduce Motion](004-thread-rise-and-reduced-motion.md) | LOW | DONE |
| 005 | [Sliding segment thumb; theme control reuses Segmented](005-sliding-segment-thumb.md) | LOW | DONE |
| 006 | [Warm tooltips](006-warm-tooltips.md) | LOW | DONE |

Already done, no plan: the mode menu (inside the … menu) and History use `sk-pop`.

## Execution order and file ownership

Run as two parallel executors with disjoint files:
- **Components**: 001 → 005 → step 2–3 of 004 (`HUDContainer.tsx`, `SettingsDrawer.tsx`, `AnswerPanel.tsx`, `ApiKeyInputs.tsx`, new `Segmented.tsx`, `ProgressiveCard.tsx`, `SettingsDrawer.test.tsx`, AnswerPanel tests).
- **CSS and hooks**: 002 → 003 → step 1 of 004 → 006 (`src/index.css`, `useTheme.ts`, `LiveOptions.tsx`, `Tip.tsx`, `usePointerHover.ts`, their tests).

001 and 005 both edit `SettingsDrawer.tsx` (same executor, in order). 004 is split between both executors by file.
