# Usability overhaul plan (16 Oct 2026)

Decided with the user in a grill-me session. Branch: `fix/usability-overhaul`, at least one commit per phase.
Audit IDs refer to [`audit.md`](audit.md).

## What was broken (user report)

- The window blocks the screen: a fixed 800×600 transparent, always-on-top window swallows clicks around the bar.
- You can't tell it's listening: nothing appears until a question is detected.
- It looks and feels janky: inconsistent styling, no transitions, the bar changes width, Start freezes the UI.

## Decisions

| Topic | Decision |
| --- | --- |
| Window | One fixed transparent window (600 pt wide, screen height, top-centre) that never resizes. Rust polls the cursor and passes clicks through everywhere except the UI's surfaces, which the frontend reports. (Shrink-to-fit was tried first: resizing WKWebView blinked the page, and pinning the web view inside a resizing window broke WebKit's hover.) |
| Position | Top-centre of the screen, just under the menu bar, on every launch. Dragging moves it for the session only; nothing is persisted. |
| Listening feedback | Two level dots inside the Stop button (them, you) from a throttled Rust level event, plus one caption line under the bar with the latest transcribed sentence and its speaker. |
| Live options | While a meeting is live, three numbered options sit under the caption and update as the conversation goes on. Before any question, all three are questions the interviewer is likely to ask next on the current topic. When a real question is asked, it takes slot 1, marked "Asked", and stays pinned there until the next question is asked. Slots 2–3 keep rolling. Nothing is answered automatically. |
| Picking | Click an option, or press the global hotkeys ⌘⌥1 / ⌘⌥2 / ⌘⌥3 (they work while the meeting app has focus). |
| Layout | Bar → caption → options → answer. The options stay visible above a streaming answer, with the picked one highlighted; picking another replaces the answer. |
| Look | Direction A (today's dark pieces, tightened) and direction C (the same layout on light frosted surfaces), with a System / Light / Dark setting. All colours become theme variables. |
| Motion | Quiet and quick: 150–200 ms ease-out fades with a 4px slide for the panel, menu, caption and options; options cross-fade when their text changes; Start↔Stop icons cross-fade; the bar never changes width. No bounce or loops. Reduced motion is respected. |
| Honesty | No canned answers or invented transcripts. Missing keys, provider errors, stalls and speech-to-text failures show a short error with what to do next. |

## Phases

### 1. Window (single agent) — done

- Rust `place_top_centre`: on setup, the window takes the main screen's work-area height and sits top-centre.
- Rust `hit_region.rs`: polls the cursor every 16 ms and sets `ignore_cursor_events` unless the cursor is over a reported rect. ⌘⇧C forces pass-through.
- Frontend `useHitRegions`: reports every `.sk-bar`, `.sk-panel`, `.sk-menu` and `.sk-surface` rect, re-measuring on resize, mount and animation end.
- Click-through on: amber ring on the bar and a "Click-through on" pill. The menu also closes on window blur.
- Debug builds: `SIDEKICK_DEV_VISIBLE=1` skips screen-share hiding and shows the window at launch, for testing.

### 2. Core fixes (two parallel Haiku agents, Opus review)

- **AI (TypeScript)**:
  - Remove the mock fallback (A1).
  - Reset the model to the provider's default when the provider changes, and update stale defaults (A2/A4).
  - Add a stall timeout and an empty-response error (A3).
  - Make `safeInvoke` failures visible to Save and Burn (F3).
- **Rust audio**:
  - Speech-to-text failure or no model → an error event, never invented text (R1/AU-N1).
  - Make `start_audio_capture` non-blocking (R3).
  - Fix the Objective-C bridge's retain and stop race (R2).
  - Add the throttled `audio_level` event.

### 3. Live options and listening UI (single agent)

- **Suggestion service** (Groq, fast model):
  - Runs on every finalised turn from either speaker, using the recent transcript.
  - Returns `{ asked, likely[3] }`.
  - One request in flight at a time, and the latest result wins.
  - Slots are stable, so unchanged options don't reorder.
  - Without a Groq key it falls back to the local heuristic for "asked" and shows a hint about predictions.
- **sessionStore**: options state.
- **UI**: caption line, options list, level dots.
- **Hotkeys**: global ⌘⌥1–3 in Rust, emitting `sidekick://pick_option`.
- **Removed**: the old quick-pointers state and the in-window ⌘↵ hint.

### 4. Theme, consistency and motion (Haiku agents for the consistency sweep, Opus review)

- **Theme variables** in `index.css` for light and dark, mapped through Tailwind.
- **Theme setting** (System / Light / Dark) in Settings, applied as `data-theme` on `<html>`.
- **Mount-delay helper** so exits can animate. Use it for the panel, menu, caption and options.
- **Fixed-width meeting button**, with icon cross-fades.
- **Consistency sweep** of every component against the tokens.

### 5. Verify and document

- Check in the real Tauri window:
  - sizing and click-through around the UI
  - drag, Hide, ⌘⇧Space
  - Start/Stop, levels, captions, options
  - ⌘⌥1–3, answers
  - theme switching, reduced motion
- Run `tsc`, vitest and `cargo test --lib`.
- Update the README, spec and audit status.

## Out of scope

Screen-share hiding (`src-tauri/src/appkit/*`), SQLite cleanup, build/signing (S4/S5), CSP (S2), minimum macOS version (S9).
