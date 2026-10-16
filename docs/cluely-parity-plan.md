# Cluely parity and polish plan (16 Oct 2026)

Decided with the user in a grill-me session, using screenshots of Cluely 2.1.24 (pill, mode menu, answer panel, Settings: General, Modes, Keybinds, About). Branch: `cluely-parity`, cut from `fix/usability-overhaul`, at least one commit per phase, local only.
Builds on [`overhaul-plan.md`](overhaul-plan.md); its decisions still hold unless changed here. Audit IDs refer to [`audit.md`](audit.md).

## Goals

- Stop ⌘⇧Space (now ⌘\) from moving keyboard focus.
- Add the Cluely features Sidekick lacks, without copying Cluely's pill (the user prefers Sidekick's).
- Adopt Cluely's keyboard map.
- Cut the time from a pick or Assist to the first answer token.
- Polish the motion.
- Make panic leave no trace of the running app.

## Decisions

| Topic | Decision |
| --- | --- |
| Focus | Show and hide never take focus. The window becomes a non-activating panel and is shown without activating the app (no `set_focus`). Sidekick takes keys only when the user clicks into it; after send or Esc it hands focus back to the previous app. |
| Pill and Ask | Today's pill stays. Ask opens the input box under the pill, focused. Every pill button gets a hover tooltip with its shortcut (like Cluely's "Open Settings ⌘,"). The Hide button shows ⌘\; the Start/Stop tooltip shows ⇧⌘\. |
| Screen | A screen toggle in the Ask box (on by default) and in the options card (off by default for picked options). Answers that used the screen show a small "Viewed screen" label. Screenshots are downscaled to at most 1280 px JPEG and captured while the prompt is built. |
| Threads | Follow-ups are a real thread: the model sees up to the last 6 exchanges, and messages stack in the panel (latest at the bottom, auto-scroll). Picking an option or pressing ⌘↵ starts a new thread. The answer panel header gets New chat (⌘R) and History. |
| History | This meeting's threads only, in memory, cleared on Stop, Burn and panic. Click one to reopen it. Nothing new is written to disk. |
| Assist (⌘↵) | Answers immediately from the screen plus the last 90 s or 6 turns of transcript (whichever is more), without taking focus: "what should I say or do now". If the user is typing in the Ask box, ⌘↵ sends the typed question instead. |
| Modes | Presets: General (today's behaviour), Behavioral (STAR stories), Coding (approach → code → complexity; screen on by default), System Design (requirements → components → trade-offs). Custom modes have a name and a prompt, no files. The mode steers answers and live options. Switch from the … menu (shows the current mode); edit in Settings → Modes. Resume and job description stay shared in Profile. |
| Settings | Stays a drawer inside the overlay, restyled with Cluely-like icon + label tabs. New: Modes, Keybinds (read-only list of every shortcut), Languages, mic source and Test. No undetectability toggle: screen-share hiding is always on in production, and only the debug-only `SIDEKICK_DEV_VISIBLE` can turn it off. No launch at login. No update checker. |
| Languages | Transcription language (Auto-detect or English, Hindi, Spanish, French, German, Portuguese, Japanese, Chinese, Korean, Arabic) passed to Whisper and Groq (today hard-coded `"en"`). Output language from the same list adds "answer in X" to the prompt. Both default to English. |
| Mic | Settings → Audio gets an input-device dropdown (plus System default; today only the default device is used) and a Test button. Test runs the mic only, with no transcription, and shows a monitoring-style meter: 24 horizontal segments, green to −18 dB, amber to −6 dB, red above, a 1 s peak-hold marker, smooth decay, −60 to 0 dB, about 30 updates a second while testing. The device applies from the next Start. The pill keeps its level dots during meetings. |
| Keys | Cluely's map. A global shortcut takes priority over the focused app, so the clashing keys are registered only while Sidekick is visible and released when it hides. See *Shortcut map*. |
| Moving and scrolling | ⌘ arrows move the window 48 pt per press, clamped so the pill stays on screen, for the session only (like dragging). ⇧⌘↑/↓ scroll the answer by a third of the panel, smoothly. Window moves jump; they don't animate. |
| Latency | Priority: pick or Assist → first answer token, under 1.5 s without the screen and 2.5 s with it. Then speech → turn end. Levers: turn-end silence 1.1 s → 0.8 s; downscaled, parallel screenshots; a warm connection to the answer provider on show and on Start; prompt caching; prefetch of the slot-1 answer. |
| Reasoning | Live options (Qwen on Groq) send `reasoning_effort: "none"` (qwen models only). Answers: a global setting under the solution models (Settings → General): "Think before answering" (default on) with a Low / Medium / High level (default Medium) for typed questions and ⌘↵ Assist; when on, an "Also think for picked options" switch (default off) applies the same level to option picks and the slot-1 prefetch; off = no thinking. No per-mode rule. Applies to Anthropic direct (`output_config.effort` / `thinking: {type: "disabled"}`), OpenAI direct (`reasoning_effort`) and OpenRouter `anthropic/…` and `openai/…` models (`reasoning.effort`). Models that can't turn thinking off (Sonnet 5.5, Opus 5.5, GPT-6.1 Sol, on every provider) show both switches on and greyed out with "This model doesn't support disabling thinking"; the level stays choosable and every answer, picks included, uses it. The saved on/off choice returns on a model that can turn thinking off. Last resort: a 400 about the thinking setting retries once without it. Turn end after 0.8 s of silence. Revised 16 Oct 2026. |
| Providers | Deepgram (speech-to-text) and Gemini (answers) are removed; speech-to-text is on-device Whisper or Groq; answers are Anthropic, OpenAI or OpenRouter (Groq answers are dropped). Saved Deepgram/Gemini/Groq-answer choices migrate to Groq speech-to-text / OpenRouter + Haiku 5.5. Revised 16 Oct 2026. |
| Models | Settings → General (was "API keys"; Profile stays its own tab) holds **Appearance** (theme, moved from its own tab) → **Solution models** → **Thinking** → **Evaluator model** → **Advanced** (Burn session and Reset, moved from the Danger tab, folded behind a chevron toggle, closed by default). The tabs are General, Profile, Modes, Audio, Keybinds. Solution models: an Anthropic \| OpenAI \| OpenRouter segmented control (like the thinking level) picks the provider that answers and shows only its card: key field with the show/hide eye and a closed model drop-down (no free text). Lists: Anthropic Haiku 5.5 (default), Sonnet 5.5, Opus 5.5; OpenAI GPT-6 Luna (default), GPT-6.1 Sol; OpenRouter all five, Haiku 5.5 default. Models that always think get "· always thinks" in their label. Each provider remembers its own model. No Save button or format check: a key saves when its field loses focus and when Settings closes. An empty key on the chosen provider shows "Add a key to get answers". Evaluator: Groq key (required; "Live options and Groq speech-to-text") and a one-entry Qwen 3.8 27B select, no toggle; without a key live options fall back to the local heuristic with the "Add a Groq key" hint. Groq speech-to-text is turned off by choosing On this Mac in Audio. Model choice lives only in Settings. Migration: unlisted saved models become their provider's default. Decided 16 Oct 2026. |
| Prefetch | When a real question lands in slot 1 ("Asked"), its answer is generated in the background, without the screen, and shown only if the user picks it (instantly, or already partly streamed). Slots 2 and 3 are never prefetched. Nothing appears on screen unasked. |
| Caching | Whichever provider is active. Anthropic, and Anthropic or Google models via OpenRouter, get an explicit cache marker; OpenAI and Groq cache repeated prefixes automatically, so the job there is a byte-stable prefix. The resume and job description come first and are the cached part; the mode prompt and output language come after, so switching modes doesn't discard the cache. 1-hour TTL. Re-cache only when the provider, model, resume or job description changes, or after an idle hour. Warm the cache with one tiny request at Start, not at launch. If the prefix is below the provider's minimum cacheable size, skip the marker silently. |
| Panic (⌘Esc) | Hide the window instantly, stop audio and wipe buffers, delete the session database, then exit the process so nothing shows in Activity Monitor. No confirmation; relaunch to use again. |
| Motion | Run the `improve-animations` audit first. Fix the known gaps: a real cross-fade when option text changes; exit animations for the answer and Settings panels, keeping their content during the exit; a theme switch that changes everything in one step; the spinner and chevron stop under reduced motion. New thread messages fade in with a 4 px rise; the mode and History menus reuse `sk-pop`. The user checks the motion by eye at the end. |
| Scope | `src-tauri/src/appkit/*` is in scope this time. `src-tauri/src/bin/test_invisibility.rs` and `scripts/test-invisibility.sh` must keep passing. |

## Shortcut map

| Scope | Keys |
| --- | --- |
| Always global | ⌘\ show / hide · ⇧⌘\ start / stop listening · ⌘Esc panic (quits) · ⌘⌥1/2/3 pick option · ⌘⇧C click-through · ⌘⇧M compact view |
| Global, only while visible | ⌘↵ Assist (or send the typed question) · ⌘R new chat · ⌘, settings · ⌘←↑→↓ move window · ⇧⌘↑/↓ scroll answer |
| In the Ask box | ↵ send · Esc close and return focus |
| Removed | ⌘⇧Space (replaced by ⌘\) · ⌘⇧S window capture (replaced by the screen toggle) |

While the visible-only keys are registered, the focused app loses them: ⌘←/→ line start/end, ⇧⌘↑/↓ select to top/bottom, ⌘R reload, ⌘↵ submit/send, ⌘, preferences. Hiding Sidekick gives them back.

## Phases

Agent assignment per phase follows the workflow in memory (`subagent-workflow`): Haiku 5.5 implementers, Sonnet 5.5 reviewers, Opus 5.5 advisor.

1. **Focus, window and panic** (Rust, `appkit/*`, `hotkeys/mod.rs`): non-activating panel; show without activating; return focus to the previous app; panic quits after the wipe and deletes the session DB. Done.
2. **Shortcuts**: new global map with visible-only registration; move and scroll; pill tooltips; Settings → Keybinds list. Done.
3. **Answers**: threads with context, New chat, session History, ⌘↵ Assist, screen toggle with downscaled parallel capture, "Viewed screen" label. Done.
4. **Settings**: icon tabs; Modes (presets and custom, wired into answer and live-option prompts, … menu picker); Languages (STT and output); mic device and Test meter. Done.
5. **Latency**: 0.8 s turn end; warm connection; prompt caching; slot-1 prefetch. Measure pick → first token before and after. Done.
5b. **Models**: Settings → General with the provider control, per-provider model lists and the Groq evaluator card; locked thinking on always-thinking models; drop Groq answers; migrate saved models. Done.
6. **Motion**: `improve-animations` audit, then the fixes listed above. Done.
7. **Verify and document**: real-window checks on the normal stealth build (focus, keys, panic, motion), `tsc`, vitest, `cargo test --lib`, `npm run build`, invisibility tests; update README, spec and audit. Done.

## Out of scope

Undetectability toggle, launch at login, update checker, calendar, notifications, billing, editable keybinds, per-mode resume and files, persistent history, build and signing (S4/S5), CSP (S2), minimum macOS (S9).
