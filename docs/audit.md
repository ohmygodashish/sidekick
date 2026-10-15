# Sidekick audit, 16 Oct 2026 (HEAD 67eb208)

> **Status update (16 Oct 2026, after the UI redesign and the config-file storage change; not yet committed).**
>
> **Fixed:**
> - Frontend: F1, F2, F6, F7; FE-N1 (Burn now ends the meeting, and Start clears the audio panic flag); FE-N2, FE-N3, FE-N5, FE-N6.
> - Audio: AU-N2 (capture only after Start); AU-N3 and AU-N4 (capture starts once per meeting, not on every summon).
> - Storage: S1 (the Keychain and its racing tests are gone).
> - Sweep: SW-1, SW-2, SW-4, SW-7 (notch layout removed), SW-8, SW-10, SW-11.
> - Design: every row in 2.6, and 2.7 except icon cross-fades and entrance transitions.
>
> **Partly fixed:**
> - F3: Download checks its result; Save and Burn still can't tell failure from success.
> - F5: App listeners are fixed; the solver's panic listeners still leak under StrictMode.
> - FE-N4: a total start failure is shown; a one-channel failure is not.
> - SW-3: non-string list items are skipped; there is no ErrorBoundary and confidence isn't clamped.
> - SW-9: the fake indicators are gone; there is no live audio level.
> - ST-N6: the README claims touched by the redesign are corrected.
>
> **Still open:** everything else, notably:
> - A1: canned answers shown as real.
> - A2: model ids don't match the provider.
> - A3: stream errors and timeouts are ignored.
> - R1 and AU-N1: invented transcripts.
> - R2: audio-bridge crash.
> - R3: main-thread freeze, now on Start.
> - S2: `csp: null`.
> - S4 and S5: build script.
> - S9: minimum macOS version.
> - F4, F8 and F9.
>
> Section 0 no longer applies once this change is in: `cargo test` uses temp directories only.

Second full audit. Six Haiku 5.5 auditors (high effort) covered: visual system, motion and interaction, frontend state, AI providers, Rust audio and STT, Rust storage/config/build. A Sonnet 5.5 (high) pass then looked for what they missed. Design passes followed the `make-interfaces-feel-better` and `emil-design-eng` skills. `design-taste-frontend` is written for marketing pages, so only its type/colour rules and its source linter were used. The UI was rendered at 800×600 in a Chromium browser pane, not in the real Tauri WKWebView. The code that hides the window from screen sharing (`src-tauri/src/appkit/*`, `test_invisibility`) was out of scope.

Every item in the top list was checked against the code, by reading it, running it, or rendering it. Items further down come from the auditors' reports and are less verified. Lines marked "verify" are claims from memory about outside APIs.

Checks: `tsc` clean, vitest 153/153, Rust unit tests 71/71.

---

## 0. Check your Keychain

`cargo test` was run twice during these audits. Its Keychain tests flip a global "mock" switch while other tests write and delete real entries under `com.sidekick.credentials` (finding S1). Open Keychain Access, search for `com.sidekick.credentials`, and confirm your API keys are still correct. Don't run `cargo test` again until S1 is fixed.

---

## 1. What commit 67eb208 changed

| Area | Result |
| --- | --- |
| Audio capture now starts | Fixed "audio never starts". New issues: it starts at launch with the window hidden, never stops, restarts on every summon, and drops the turn in progress each time (AU-N2, AU-N3, AU-N4, ST-N1). |
| Groq / Deepgram speech-to-text | Now real HTTP calls; only the chosen engine is used. A failure or missing key falls back to invented transcript text (AU-N1). |
| `useQuestionDetector({ allowCandidate: true })` | New bug: your own speech can become the active question in every layout (FE-N3). |
| Settings inputs and provider rows | Padding unified, long subtitles truncate. Token drift elsewhere unchanged. |
| Window shadow off | No issues found. |
| First audit's 20 findings | None fully fixed. #19 and #20 partly improved. |

---

## 2. All findings by area

### 2.1 Frontend state and hooks

Status of earlier findings: F1 Deep Solve self-cancel, F2 Enter in Settings, F3 safeInvoke null, F4 burn doesn't stop solves, F5 StrictMode listener leaks, F6 old answer not cleared, F7 reset doesn't resync STT, F8 out-of-order detection, F9 unbounded transcript, F10 dead listeners. **All still present.**

New:
- **FE-N1 Burn Session silently stops transcription** until the window is hidden and shown again. `burn_session` calls `purge()`, which sets the audio panic flag, and nothing restarts capture. `SettingsDrawer.tsx:101-113`, `src-tauri/src/lib.rs:31`, `audio/mod.rs:317`. Fix: clear the flag in `burn_session`, or call `startAudioCapture()` after the burn.
- **FE-N2 Reset All Settings, then Save, deletes every Keychain key.** Reset blanks `apiKeys` in memory, Save sends all six providers, and an empty value means delete. The same happens if keys failed to load at launch. `settingsStore.ts:117-120, 183`, `keychain.rs:74-76`. Fix: save only the providers the user edited, and don't blank keys on reset.
- **FE-N3 Your own speech replaces the interviewer's question.** `App.tsx:19` passes `allowCandidate: true`. Fix: `useQuestionDetector()`.
- **FE-N4 Partial audio start failure is invisible.** Rust returns Ok if one channel works, and the warnings go to an event nobody listens to. `audio/mod.rs:267-283`. Fix: listen to `sidekick://audio_status_changed` and show a banner.
- **FE-N5 Model download shows "downloaded & loaded" after a failure.** `SettingsDrawer.tsx:68-80`; `safeInvoke` never throws. The Rust reload error is also discarded (`audio/mod.rs:426`). Fix: make `downloadSttModel` throw on error.
- **FE-N6 A superseded solve's `finally` resets the newer solve's busy state.** `useDeepSolver.ts:199-204`. Fix: guard all three resets with `abortControllerRef.current === controller`.
- **FE-N7 Layout mode in the effect dependencies causes resubscribe churn.** `useQuestionDetector.ts:94, 105`. Low.

### 2.2 AI providers

Status: A1 mock answer shown as real, A2 one model id for every provider, A3 stream errors/timeout ignored, A4 stale model ids, A5 o4/gpt-5 regex, A6 `<…>` stripping, A7 stage 2 lost without its wrapper, A8 invented O(N), A9 heuristic misfires, A10 Gemini key in URL, A11 duplicated adapters. **All still present.** A12 (one detection call per turn) is worse, because candidate turns now trigger calls too.

New:
- **AI-N1 A full-resolution screenshot is attached to every solve.** It is taken before the key check and sent even to Groq's text-only default model; multi-MB Retina PNGs can exceed provider image limits (verify). `useDeepSolver.ts:122-135`, `window_grab.rs:284-341`. Fix: downscale and JPEG in Rust, and attach only for vision-capable models.
- **AI-N2 Resume and job description go into the system prompt with no size cap** and are re-sent on every solve with no prompt caching. A large text file can exceed the context window, and the error then shows as the mock answer. `promptTemplates.ts:59-77`, `ProfileEditor.tsx:84`. Fix: cap each field and reject oversized drops.
- **AI-N3 Persisted settings have no version or migration,** so changed defaults never reach existing users. `settingsStore.ts:185-194`.
- **AI-N4 Truncated or empty answers are not detected.** `finish_reason`/`stop_reason` are never read, and `max_tokens` is 4096 everywhere. For reasoning models, hidden reasoning counts against it (verify).
- **AI-N5 The mock answer is keyword-matched on the whole prompt, including the transcript.** "target QPS" returns Two Sum. `dispatcher.ts:341, 419`.
- **AI-N6 The Groq detector timeout doesn't cover reading the body;** HTTP errors silently fall back to the heuristic. `questionDetector.ts:376-421`.
- **AI-N7 Transcript, job description and resume are pasted into prompts without delimiters** (prompt steering). `promptTemplates.ts:66-77, 141, 151`.
- **AI-N8 Anthropic requests omit temperature,** while the other providers use 0.2. `anthropic.ts:44-52`.
- **AI-N9 Profile data sits in plain localStorage,** while the banner says only keys are kept off disk. `settingsStore.ts:185-194`.

### 2.3 Rust audio and speech-to-text

Status: R1 invented transcript with no model, R2 Objective-C bridge NULL race and malloc'd ARC struct, R3 sync start on the main thread (now hit on every summon), R5 download problems, R6 Ok on partial failure, R7 mic unplug / stop-sharing not observed, R8 pre-panic audio transcribed after restart, R9 full PCM emitted to nobody, R10 resampler. **All still present.** R4 cloud STT is now implemented.

New:
- **AU-N1 Cloud STT failure or missing key produces invented text** that is stored as a real turn. `stt_dispatcher.rs:286-323`, `whisper.rs:539`. Fix: return Err when `is_mock_or_fallback` is set.
- **AU-N2 Capture and cloud upload start at launch with no user action** and continue while the window is hidden. Nothing calls `stopAudioCapture`. `App.tsx:33-36`, `hotkeys/mod.rs:243-251`. Decide whether this is intended. At minimum, add an on/off control and an honest status.
- **AU-N3 Every summon briefly runs two streams into one mixer.** The old stream is dropped only after the new one is up (up to ~6 s). `audio/mod.rs:186-216, 230-255`. Fix: return early when already capturing.
- **AU-N4 Every summon throws away the turn in progress.** The mixer is rebuilt at `audio/mod.rs:178-181`.
- **AU-N5 A failed restart keeps the old, dead stream** and still reports "capturing". `audio/mod.rs:208-216, 246-255`.
- **AU-N6 If ScreenCaptureKit start times out, the stream keeps running** with no consumer. `sck_audio_bridge.m:238-243`. Fix: call `stopCaptureWithCompletionHandler` on that path.
- **AU-N7 The 300 s total download timeout fails base.en on links slower than ~4 Mbit/s** (verify). `whisper.rs:98-100`.
- **AU-N8 A single STT worker, a 10 s cloud timeout and a 32-slot queue.** Under load the newest turn is the one dropped. `stt_dispatcher.rs:437-500`.
- **AU-N9 Keychain read and a new HTTP client on every turn.** `stt_dispatcher.rs:286, 307, 339-342`.
- **AU-N10 Latent `block_on` panic** if transcription ever runs on an async thread; `panic = "abort"` would kill the app. `stt_dispatcher.rs:344-414`.
- **AU-N11 Groq requests have no `language=en` and no filter for filler-only output** (Whisper invents text on noise; verify). `stt_dispatcher.rs:334-337`.
- **AU-N12 Lean:** two 60 s ring buffers (~7.7 MB) allocated per summon with no reader (`mixer.rs:369-378`). The multi-channel bridge branch is dead and indexes past its buffer (`sck_audio_bridge.m:52-63, 99`).

### 2.4 Rust storage, config, build, tests, README

Status: S1 Keychain test race, S2 `csp: null`, S3 delete Ok on error, S4 ad-hoc codesign without entitlements (confirmed on the built .app), S5 `--universal` path, S6 burn ignores errors, S7 panic doesn't stop detection, S8 hotkey collisions, S9 no minimum macOS (built bundle says 10.13), S10 Cmd+Shift+S capture discarded, S11 SQLite writers unused, S12 DB permissions and `/tmp` fallback, S13 entitlements inert, S14 `.gitignore` gaps. **All still present.**

New:
- **ST-N1 Recording continues while the window is hidden** (same root cause as AU-N2).
- **ST-N2 Keychain read errors look like "no key".** `keychain.rs:137-143`.
- **ST-N3 If another app already holds one of the hotkeys, launch aborts with no message** (verify). `lib.rs:46-60, 103`.
- **ST-N4 Hotkey state is split between Rust and JS.** The JS opacity default (0.85) is overwritten by Rust's (1.0) at mount, and `resetPanic` clears only the JS flag. `appStore.ts:28, 75-78`, `hotkeys/mod.rs:135`.
- **ST-N5 Tests that cannot fail or leave state behind:**
  - `keychain.rs:294-297` asserts only inside `if let Err` and leaves a real Keychain item behind.
  - `hotkeys/mod.rs:525-535` asserts constants.
  - `whisper.rs:625` asserts wall-clock latency.
  - `appStore.test.ts` burn test asserts inside an `if`.
  - `ipc.test.ts` covers only the outside-Tauri path.
- **ST-N6 README claims the code does not support:**
  - "hardware-backed" keys (it's a login-keychain password)
  - "scrubbed on panic" (panic never touches the DB or JS state)
  - detection "< 800 ms" (1.1 s of silence alone, plus a 3.5 s timeout)
  - "100% offline" (only STT is)
  - `silence_threshold = 0.008` (the code uses 0.015)
  - Cmd+Shift+S sends the image to the model (it's discarded)
  - file names in the diagram
  - the "Rust 1.78+" badge
- **ST-N7 Whisper models are downloaded with no checksum** and parsed by native code. `whisper.rs:85-135`.
- **ST-N8 Screen Recording permission is never preflighted;** a blank capture can be sent as success. `window_grab.rs:192-279`.
- **ST-N9 Duplicate crate versions** (security-framework 2/3, core-graphics 0.24/0.25), unmaintained cocoa/objc, no `rust-version`.

### 2.5 Final sweep (Sonnet), not found by the Haiku auditors

- **SW-1 The window cannot be dragged.** `data-tauri-drag-region` needs `core:window:allow-start-dragging`, which isn't in `capabilities/default.json` (confirmed in the generated ACL). Fix: add that permission.
- **SW-2 The code view deletes numbers.** `1e9`, `0xFF` and `1_000_000` vanish from displayed code (confirmed by running the regex). `CodeBlock.tsx:36-37, 127`. Fix: number branch `\b\d[\w.]*`, plus a catch-all branch that renders unmatched text.
- **SW-3 One malformed AI response can blank the overlay.** There is no ErrorBoundary, and `quick_pointers`/`key_tradeoffs` items aren't checked to be strings (an object crashes React). Confidence isn't clamped (85 shows as "8500%"). `questionDetector.ts:442`, `streamParser.ts:164-182`, `main.tsx`.
- **SW-4 The highlighter treats `//` and `#` as comments in every language.** Python `(lo + hi) // 2` renders as a comment. `CodeBlock.tsx:37`.
- **SW-5 Panic keeps the transcript and answer in memory,** and the "Panic / Resume" banner is unreachable (summon clears the flag first). `appStore.ts:116-128`.
- **SW-6 `capture_active_window`, `store_api_key` and `retrieve_api_key` are sync commands on the main thread.** Six Keychain reads at launch, so a Keychain prompt can freeze the UI and delay the panic hide.
- **SW-7 Notch mode only changes CSS.** The window is never moved or resized (no `set_position` anywhere), and the notch has no opacity control. `hotkeys/mod.rs:299-337`.
- **SW-8 Two tone presets can't be selected.** The default tone `balanced` and `deep` have no option in the UI, and the "Concise 3 Bullets" card doesn't match its prompt. `ProfileEditor.tsx:27-52`.
- **SW-9 Status indicators are hard-coded.** The waveform always animates, "Listening" shows with no audio, and "Invisible" is always shown. `NotchCompanion.tsx:100-146`, `HUDContainer.tsx:98-120`.
- **SW-10 Holding Enter starts several billed solves.** There is no `e.repeat` check. `useQuestionDetector.ts:111-128`.
- **SW-11 Raw tag fragments (`<stage_1_in`) flash as Stage 1** at the start of every stream, then the card remounts and loses its collapse state. `streamParser.ts:211-219, 334-345`.
- **SW-12 The mic channel can re-transcribe the interviewer from speakers.** With `allowCandidate`, it's detected twice. Turn ids have no channel, so two turns ending in the same millisecond collide. `mixer.rs:360-413`, `stt_dispatcher.rs:113-115`.
- **SW-13 Lean:** unused stage setters and provider/model fields in `sessionStore.ts`; each stage is stored twice; unreachable notch branches in `HUDContainer.tsx:48, 55, 201`; `dispatch_chunk` and `greet` are unused.

### 2.6 Design: visual system (make-interfaces-feel-better format)

"Render" means seen in the 800×600 browser render.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `HUDContainer.tsx:54, 63, 171`, `App.tsx:72` | `flex-wrap` header plus `max-h-[calc(100vh-120px)]` main, `shadow-2xl`, in an `h-screen overflow-hidden` root | Hide control labels below `md`, make main `flex-1 min-h-0`, keep 16px clear around the card | Render: the header wraps to two rows. With an answer, the panel fills the window and its bottom corners and shadow are cut off. |
| HIGH | `CodeBlock.tsx:217` inside `HUDContainer.tsx:171` | Code block has its own `max-h` scroll inside the scrolling HUD body | One scroll container; let the code block grow | Render: the mouse wheel gets stuck in the code and stage 3 can't be reached. |
| MEDIUM | `SettingsDrawer.tsx:135` | `fixed inset-0 bg-black/60 backdrop-blur-sm` | `fixed inset-0` transparent click-catcher | Render: dims and blurs the whole transparent window, not just the panel. |
| MEDIUM | `SettingsDrawer.tsx:181-233` | 4 `whitespace-nowrap` tabs in a 500px sheet | `grid grid-cols-4`, short labels (Keys, Profile, Audio, Danger) | Render: "Danger Zone" is cut off even when selected. |
| MEDIUM | `HUDContainer.tsx:226-250`, `NotchCompanion.tsx` idle card | Idle "Stealth Copilot Ready" / "Webcam Eye Contact Mode" cards stay above the answer | Show idle cards only when there is no question and no answer | Render: they push the answer down in a small window. |
| MEDIUM | `tailwind.config.js:24`, `package.json`; 10 `animate-in` sites; `py-0.2` ×5; `custom-scrollbar` ×4 | Classes that generate no CSS | Install `tailwindcss-animate` (or delete the classes), `py-0.5`, define `.custom-scrollbar` | Unknown classes are silently dropped. |
| MEDIUM | Token drift, all components | Card bg /30 /40 /50 /60; borders /40 /50 /60 /80 /90 and solid; 9/10/11/12/14px text; 6 radii; 5 kbd chip styles | One `@layer components` set: `.panel`, `.control`, `.chip`, `.label`, `.title`, `.btn-primary`, `.btn-danger`; text at 11/12/14 only | The same role looks different on each screen. |
| MEDIUM | Accent hues: sky ≈96 uses, red 68, emerald 62, purple 41, amber 28 | Sky and emerald both mean "action" (Save is sky, Download is emerald) and "focus" (inputs sky, slider emerald) | Sky = action/selection, emerald = live/success, red = danger; purple/amber only for the stage taxonomy | Each hue should have one job. |
| MEDIUM | `ProgressiveCard.tsx:191, 231` + `CodeBlock.tsx:174`; `SettingsDrawer.tsx:507, 521` | `rounded-xl` card, 12px padding, `rounded-xl` inner block | Inner `rounded-none` full-bleed (12 = 0 + 12), or outer `rounded-3xl` | Nested corners should be concentric. |
| MEDIUM | `index.html:9`, `src/index.css` | No `antialiased`, no `color-scheme` | `antialiased` on body; `html { color-scheme: dark; }` | Light text on dark renders heavy on macOS; native select and scrollbars stay light. |
| MEDIUM | `QuestionBanner.tsx:89` (16px), `ApiKeyInputs.tsx:323` (22px), `NotchCompanion.tsx:201, 213` (24px), notch toolbar ~19px, `CodeBlock.tsx:193` ~20px | Glyph-sized hit areas | `size-8` minimum; extend with `after:` where dense | Small targets are hard to hit mid-call. |
| LOW | `HUDContainer.tsx:147` h-3 / `NotchCompanion.tsx:203` h-3.5 / `:293` h-2.5 (gear; same for alert, pointer, sparkles) | Same-role icons at three sizes; default stroke at 10px | One size per role; `strokeWidth={2.5}` at h-2.5/h-3 | Icon weight should match its label. |
| LOW | zinc-500 at 9-11px (`NotchCompanion.tsx:175, 271`, `HUDContainer.tsx:232, 264`, …), zinc-600 line numbers and placeholders | About 4.1:1 and 2.6:1 on zinc-950, worse over glass | Hints in zinc-400, placeholders in zinc-500, chips at 10px | Readability. |
| LOW | `App.tsx:74` `sm:pt-1`, `NotchCompanion.tsx:85` `rounded-t-lg` | Notch floats 4px below the top with rounded top corners | `pt-0`, `rounded-t-none` | Render: visible gap; a notch should grow from the bezel. |
| LOW | Copy: `HUDContainer.tsx:245` "NSWindowSharingNone", `SettingsDrawer.tsx:510` "(REQ-017)", `ApiKeyInputs.tsx:170` "(SEC-001)", `:245` "6 Providers Supported", `SettingsDrawer.tsx:70` "ggml-tiny.en.bin"; click-through named 4 ways; stage titles differ HUD vs notch; `...` vs `…`; "Model:" and "PYTHON" in mono | Implementation names and drift | Plain names, one glossary, `…`, mono only for code and kbd | Render: confirmed in settings and solution views. |
| LOW | `ProfileEditor.tsx:185-186` | Word/char counts in proportional digits | `tabular-nums` | Counts shift while typing. |

### 2.7 Design: motion and interaction (emil-design-eng format)

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `SettingsDrawer.tsx:139-143`, `HUDContainer.tsx:155` | `role="dialog" aria-modal` with no focus move or trap; HUD behind it still focusable | Focus the close button on open, `inert` on the HUD root, restore focus on close | Tab reaches the hidden Panic button; Enter fires panic mid-call. |
| HIGH | `SettingsDrawer.tsx:517-547` | Burn and Reset run on one click; Burn clears the store before the IPC call | Two-step "Click again to confirm" (3 s) | Irreversible, and Reset+Save also deletes keys (FE-N2). |
| MEDIUM | `NotchCompanion.tsx:110-138`, `tailwind.config.js:10-20` | Infinite `animate-waveform-*` animating `height`, not tied to audio | Drive `transform: scaleY()` from audio level; static when idle | Always moving during a call, and it implies audio that may not exist. |
| MEDIUM | `HUDContainer.tsx:76, 97`, `NotchCompanion.tsx:149, 151, 180`, `SettingsDrawer.tsx:490`, `CodeBlock.tsx:222` | `animate-pulse` / `ping` / `bounce`, infinite | Static dot plus label; `motion-reduce:animate-none` | Motion restraint; only the waveform has reduced-motion handling. |
| MEDIUM | `App.tsx:72, 80-82` | `transition-all duration-300` on the root; Cmd+Shift+M animates padding | No transition on the layout switch | Keyboard actions should never animate; padding is a layout property. |
| MEDIUM | `NotchCompanion.tsx:81, 87-88, 228` | Opens on mouse hover; `h-[42px]` to auto-height under `transition-all duration-300` | Open on click or hotkey; `grid-rows-[0fr]→[1fr]` or numeric max-height, 200ms, `cubic-bezier(0.23,1,0.32,1)` | Height to auto snaps; hovering opens a 540px panel over the call. |
| MEDIUM | 15 sites: `App.tsx:72`, `HUDContainer.tsx:54`, `NotchCompanion.tsx:87`, `OpacityControl.tsx:52`, `ProgressiveCard.tsx:110, 191, 263`, `QuestionBanner.tsx:61, 138`, `ProfileEditor.tsx:209, 267`, `SettingsDrawer.tsx:278, 306, 334, 521` | `transition-all` | `transition-[background-color,border-color]` or `transition-transform` | Name the properties. |
| MEDIUM | About 55 buttons; only `QuestionBanner.tsx:138` has press scale (0.95) | No `:active` feedback | `active:scale-[0.96] transition-transform duration-150 ease-out` on every button | Press feedback. |
| MEDIUM | No `focus-visible` anywhere; inputs use a sky ring, slider emerald, buttons the browser default | Three focus treatments | One `focus-visible:ring-1 ring-sky-500` on every control | Render: the browser default ring shows, but it doesn't match. |
| MEDIUM | `ApiKeyInputs.tsx:157-161, 276` | Save has no pending or error state; Test button has no disabled style; 150ms fake spinner | `disabled={saving}` plus spinner plus error line; `disabled:opacity-50` | Double-click saves twice; failures are silent. |
| MEDIUM | `ApiKeyInputs.tsx:189, 208, 223`, `ProfileEditor.tsx:144, 160, 179, 299`, `SettingsDrawer.tsx:183-241, 273-354`, `NotchCompanion.tsx:80`, `ProfileEditor.tsx:202-214` | Labels not linked; tabs and option cards without `aria-selected`/`aria-pressed`; `aria-expanded` on a region; mouse-only drop zone | `htmlFor`/`id`, `role="tablist"`, `aria-pressed`, a `<label>` wrapping the file input | Screen readers and keyboard users. |
| LOW | `QuestionBanner.tsx:27`, `ProgressiveCard.tsx:106, 187, 259` | Question card and stages mount at full size | `transition-[opacity,transform] duration-200 ease-out` from `opacity:0; translateY(-4px)` via `@starting-style` | Content pops in; keep it under 200ms. |
| LOW | Chevrons `ProgressiveCard.tsx:138-142, 219-223, 291-295`, `NotchCompanion.tsx:215-219`; Copy/Check, Eye/EyeOff, Save/Check | Icon swaps with no transition | One chevron with `rotate-180`; cross-fade the others (opacity, scale 0.25→1, blur 4px→0) | Contextual icon animation. |
| LOW | `ApiKeyInputs.tsx:160`, `ProfileEditor.tsx:115`, `CodeBlock.tsx:156`, `SettingsDrawer.tsx:76, 79, 112, 119` | Feedback timers of 2000-4000ms, not cleared | One 2000ms duration; clear on re-arm and on unmount | A quick re-click clears the new message early. |

---

## 3. Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `OpacityControl.tsx:52` | "Slider has no visible thumb" (rated HIGH by an auditor) | The render shows the thumb drawn normally. |
| All panels | design-taste-frontend bans on glass/backdrop blur and hairline borders | That skill targets marketing pages; translucency is this overlay's core look. |
| HUD, notch, settings open | Staggered entrance animations | They open by hotkey many times a day; emil-design-eng says such actions should not animate. |
| `kbd` chips, code | design-taste-frontend monospace ban | Mono is right for code and key caps; only the "Model:" and "PYTHON" labels should change. |

---

## 4. Verification and verdict

Run:
- `npx tsc --noEmit`: clean
- `npx vitest run`: 153 passed
- `cargo test --lib`: 71 passed (see section 0)
- `codesign -d` and `vtool` on the built .app (by an auditor)
- The CodeBlock tokenizer regex run on `INF = 1e9 + 7` and `mask = 0xFF & x`: numbers dropped
- `design-taste-frontend` `lint.mjs` over `src/components`
- Rendered at 800×600 in the browser pane: HUD idle, Settings (all tabs), a solution (mock stream), notch expanded, Tab focus

Not verified:
- Anything in the real Tauri window (WKWebView, transparency over the desktop, drag, global hotkeys, audio capture, Keychain prompts)
- Motion at 10% speed (most animation classes generate no CSS)
- Claims marked "verify" about provider APIs and Apple frameworks

**Verdict: Block.** HIGH findings remain in both behaviour and design.
