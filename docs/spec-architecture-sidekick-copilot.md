---
title: Sidekick Invisible Interview & Meeting Copilot Architecture Specification
version: 1.0.0
date_created: 2026-10-15
last_updated: 2026-10-17
owner: Sidekick Engineering Team
tags: [architecture, design, app, stealth, audio, ai, macos]
---

# Introduction

Sidekick is a hyper-lightweight, screen-share invisible desktop application for macOS built with Tauri v2 (Rust) and React 19. It acts as a real-time copilot during technical interviews (coding, system design, behavioral) and high-stakes meetings. It achieves zero-suspicion operation through OS-level window invisibility (`NSWindowSharingNone`), Dock/app-switcher concealment, silent screen capture for answers, behind two screen toggles, driverless dual-audio ingestion (system meeting sound via `ScreenCaptureKit` + microphone), live numbered question options (the question just asked plus likely next ones), and progressive disclosure problem solving powered by a multi-provider AI gateway (OpenRouter, Anthropic, OpenAI), Groq for live options, and embedded offline `whisper.cpp`.

## 1. Purpose & Scope

### 1.1 Purpose
This specification defines the architectural structure, component boundaries, data contracts, security constraints, and behavioral requirements for Sidekick. It provides the definitive standard for implementation, automated testing, and GenAI code generation.

### 1.2 Scope
* **Target Operating System**: macOS 13.0+ (Ventura, Sonoma, Sequoia) supporting Apple Silicon (M1/M2/M3/M4) and Intel architectures.
* **Core Capabilities**:
  * Screen-share invisibility preventing capture by Zoom, Google Meet, Microsoft Teams, Slack, Discord, QuickTime, and OBS.
  * System audio capture of meeting participants without virtual audio drivers (BlackHole/Loopback).
  * On-device speech-to-text using Metal-accelerated `whisper.cpp` alongside optional Groq Whisper.
  * Live numbered options during the conversation: the question just asked (pinned) and three likely next questions, updated after every turn and answered on demand with `Cmd + Option + 1/2/3`.
  * Follow-up threads with six exchanges of context, New chat, a meeting-only History, and `Cmd + Enter` Assist.
  * Screen context for answers: when a prompt uses the screen, the frontmost window is captured silently (Ask-box and options toggles; Assist always). No crosshair selection.
  * Progressive disclosure solution rendering across 3 structured tiers (Intuition $\rightarrow$ Code $\rightarrow$ Complexity).
  * Answers from OpenRouter, Anthropic or OpenAI, live options and optional speech-to-text on Groq, with API keys stored in a local config file (`~/.config/sidekick/config.json`, mode `0600`).
  * A click-through overlay (clicks pass through everywhere except the visible UI) with System, Light and Dark themes.
* **Out of Scope**: Windows or Linux native builds for v1.0 (macOS AppKit specialization is required for driverless `ScreenCaptureKit` and `NSWindowSharingNone`).

### 1.3 Intended Audience & Assumptions
* **Audience**: AI code generation agents, core software engineers, QA verification engineers.
* **Assumptions**: User has granted macOS Screen Recording and Microphone permissions upon first application launch.

## 2. Definitions

| Term / Acronym | Definition |
| :--- | :--- |
| **AppKit** | macOS native Objective-C/Swift UI framework providing `NSWindow`, `NSApplication`, and window server integration. |
| **`NSWindowSharingNone`** | AppKit window sharing type that completely excludes the window from all OS display capture and screen sharing sessions. |
| **Accessory App** | An application running with `NSApplicationActivationPolicyAccessory`, having no Dock tile, excluded from `Cmd + Tab`, and having no Menu Bar or Status Bar tray item. |
| **SCK** | **ScreenCaptureKit**: High-performance macOS 13+ native screen and audio capture framework. |
| **STT** | **Speech-to-Text**: Transcription engine converting spoken audio into textual turn streams. |
| **VAD** | **Voice Activity Detection**: Algorithm distinguishing human speech from background noise and detecting turn pauses. |
| **TTFT** | **Time-to-First-Token**: Milliseconds elapsed between request dispatch and the first rendered token of an LLM stream. |
| **LPU** | **Language Processing Unit**: Hardware architecture (e.g., Groq) providing deterministic sub-100ms LLM inference. |
| **Progressive Disclosure**| UX pattern breaking complex problem solutions into staged digestible steps (Intuition $\rightarrow$ Code $\rightarrow$ Complexity). |
| **STAR Method** | Structured behavioral framework: Situation, Task, Action, Result. |

## 3. Requirements, Constraints & Guidelines

### 3.1 Functional Requirements
- **REQ-001 (Screen-Share Invisibility)**: The window server MUST assign `NSWindow.sharingType = .none` to all overlay windows immediately upon window allocation.
- **REQ-002 (Headless Phantom / Hotkey-Only Control)**: The application runtime MUST configure `NSApplicationActivationPolicyAccessory` before showing any UI, suppressing Dock icons and `Cmd + Tab` inclusion. Furthermore, the application MUST NOT register any system Status Bar item, Menu Bar icon, or System Tray icon. The application MUST be 100% headless with zero persistent visual footprint on the OS, summoned and dismissed purely via global hotkeys (`Cmd + \` to show or hide, `Shift + Cmd + \` to start or stop listening, `Cmd + Esc` to panic: hide, wipe and quit). Access to Application Settings MUST only be accessible from within the overlay UI (or via `Cmd + ,` while the overlay is visible) once summoned. Showing or hiding MUST never take keyboard focus from the app the user is using: the window is a non-activating panel. Clicking a text field MUST give it the keyboard, and send or Esc MUST hand focus back.
- **REQ-003 (Z-Index / Level)**: The overlay window MUST be assigned `NSWindow.Level.floating` and `NSWindowCollectionBehaviorFullScreenAuxiliary` to remain accessible above full-screen IDEs and video conference apps.
- **REQ-004 (Panic Shutdown)**: Global hotkey `Cmd + Esc` MUST synchronously hide the window in <25ms, stop audio capture and wipe its buffers, abort in-flight network streams, delete the session database, and then exit the process. It MUST NOT ask for confirmation; the user relaunches the app to use it again.
- **REQ-005 (Click-Through Mode)**: Outside click-through mode, the window MUST pass mouse events to background applications everywhere except over the visible UI surfaces (the frontend reports their rects; `hit_region.rs` polls the cursor and toggles `set_ignore_cursor_events`). Global hotkey `Cmd + Shift + C` MUST force pass-through everywhere, shown by an amber outline on the bar and a pill under it.
- **REQ-006 (Minimal Overlay UI)**: The window MUST be one fixed transparent window at the top-centre of the main screen that never resizes (resizing WKWebView repaints the page). The user interface MUST consist of one control bar, a caption and live options while listening (REQ-011), and one panel slot below:
  - *Control bar*: Start/Stop meeting (`Shift + Cmd + \`; fixed width; level dots and elapsed time while live), Ask (opens a typed question), Hide (`Cmd + \`), and a menu with opacity (15%–100%), compact view (`Cmd + Shift + M`), click-through (`Cmd + Shift + C`), settings (`Cmd + ,`) and panic (`Cmd + Esc`). Start/Stop and Hide MUST show their shortcut in a hover tooltip. The bar MUST be draggable (requires the `core:window:allow-start-dragging` capability).
  - *Panel*: shows either the answer (REQ-015) or settings, never both. Compact view (layout value `dynamic_notch`) hides the panel and leaves only the bar.
- **REQ-007 (Driverless Audio Ingestion)**: Meeting audio MUST be captured via `ScreenCaptureKit` system audio stream without requiring third-party kernel extensions or virtual audio cables. Candidate audio MUST be ingested via default microphone.
- **REQ-008 (Speaker Diarization)**: Ingested audio MUST be split into two discrete logical channels: Channel 0 (Interviewer / System) and Channel 1 (Candidate / Mic).
- **REQ-009 (Embedded Offline STT)**: The application MUST embed `whisper.cpp` compiled with Apple Metal support to perform 100% on-device speech transcription without external network requests.
- **REQ-010 (Cloud STT Option)**: The application MUST support choosing Groq Whisper (`whisper-large-v3-turbo`) instead of on-device Whisper in Settings → Audio.
- **REQ-011 (Live Options)**: While a meeting is live (REQ-018), after every transcript turn a fast evaluator (Groq, `qwen/qwen3.8-27b` by default) MUST receive the recent transcript (last 12 turns, as data inside `<transcript>` delimiters) and return the question the interviewer just asked (or none) and three likely next questions. The UI MUST show up to three numbered options: the asked question pinned in slot 1, marked "Asked", until the next question is asked, then the likely ones. Only one request MAY run at a time; turns that arrive meanwhile MUST trigger one rerun with the latest transcript. Without a Groq key, a local heuristic MUST still spot asked questions. Nothing is answered automatically.
- **REQ-012 (On-Demand Deep Trigger)**: The user MUST be able to answer option 1, 2 or 3 by clicking it or with the global hotkeys `Cmd + Option + 1/2/3` (which also summon a hidden overlay); the recent conversation MUST be sent as context. Ask MUST open a box where the user can type a question; the same box MUST accept follow-ups.
- **REQ-019 (Listening Feedback)**: While live, the bar MUST show two level dots (system audio and microphone, from the throttled `sidekick://audio_level` event), and a two-line caption MUST show the latest sentence from each source. Speech-to-text failures MUST be reported (`sidekick://stt_error`) and shown in the caption; transcript text MUST never be invented.
- **REQ-020 (Themes)**: The UI MUST offer System, Light and Dark themes in Settings → General (Appearance); System MUST follow the macOS appearance as it changes.
- **REQ-013 (Silent Active Window Capture)**: Removed (16 Oct 2026). The `Cmd + Shift + S` capture was replaced by the screen toggles; see REQ-021.
- **REQ-014 (Multi-Provider Deep Gateway)**: The Deep Intelligence Engine MUST support direct API integration for:
  - OpenRouter (default `anthropic/claude-haiku-5.5`; Haiku 5.5, Sonnet 5.5, Opus 5.5, GPT-6 Luna and GPT-6.1 Sol)
  - Anthropic Direct (default `claude-haiku-5-5`; Sonnet 5.5 and Opus 5.5)
  - OpenAI Direct (default `gpt-6-luna`; GPT-6.1 Sol)
  Google Gemini and Groq answers were removed (16 Oct 2026). Groq is used for live options and optional speech-to-text only.
  A missing key, provider error, 25 s stall or empty answer MUST be shown as a short error; the engine MUST NOT substitute a canned answer.
- **REQ-015 (Progressive Disclosure Rendering)**: Output from the Deep Engine MUST render in one answer panel, in this order:
  1. *Stage 1*: a short answer with up to three key points, always visible.
  2. *Stage 2*: a Code row (syntax-highlighted, copyable), expanded by default.
  3. *Stage 3*: a Complexity row (Big-O and edge cases), collapsed by default.
  A pick or `Cmd + Enter` Assist MUST start a new thread (the previous thread stays in History; see REQ-022), a follow-up MUST add a message to the current thread, a working state MUST be shown while solving, errors MUST be shown with a Retry action, and closing the panel MUST cancel an in-flight solve.
- **REQ-016 (Personalization Profiles)**: The engine MUST incorporate user-provided resume text (pasted, or a `.txt`/`.md` file up to 200 KB; other formats, including PDF, are rejected with a message), job descriptions, seniority and tone (concise, balanced, deep, staff, system_architect) into the LLM system prompt.
- **REQ-017 (Session Wipe / Burn)**: The UI MUST provide a "Burn Session" command, confirmed by a second click within 3 seconds, that immediately purges local SQLite cache, memory buffers and temporary files, and ends the meeting. It MUST NOT touch the config file (SEC-001). "Reset Settings" MUST use the same two-click confirm and MUST keep API keys.
- **REQ-018 (User-Controlled Meeting Capture)**: Audio capture MUST NOT start at launch or on summon. It MUST start only when the user presses Start and stop when the user presses Stop; Burn (REQ-017) MUST also end the meeting, and Panic (REQ-004) quits the app. While live, the control bar MUST show a recording indicator and the elapsed time. If starting or stopping fails, the error MUST be shown under the bar.
- **REQ-021 (Screen Context)**: Answers MAY use the screen. The Ask box has a screen toggle (on by default), the options card has one (off by default; the Coding mode turns it on), and `Cmd + Enter` Assist always uses the screen. When a prompt uses the screen, the app MUST capture the frontmost window other than Sidekick while the prompt is built, silently (no crosshairs, no shutter sound, no mouse input), downscale it so its longest edge is at most 1280 px, and send it as JPEG. A typed or picked question MUST NOT capture the screen while its toggle is off. An answer that used the screen MUST show a "Viewed screen" label.
- **REQ-022 (Threads, Assist and History)**: Follow-ups MUST keep the last six exchanges as context. `Cmd + Enter` Assist MUST answer from the screen and the transcript of the last 90 s or six turns, whichever is more, without taking keyboard focus; when the Ask box has typed text it MUST send that text instead. `Cmd + R` MUST start a new chat. History MUST list only this meeting's threads, kept in memory, and MUST be cleared on Stop, Burn and panic. Nothing MUST be written to disk.

### 3.2 Security Requirements
- **SEC-001 (Credential Isolation)**: All third-party API keys (OpenRouter, Anthropic, OpenAI, Groq) MUST be stored only in the local config file `~/.config/sidekick/config.json` (or `$XDG_CONFIG_HOME/sidekick/config.json` when `XDG_CONFIG_HOME` is an absolute path). The directory MUST be created with mode `0700` and the file MUST be written with mode `0600`, re-applied on every write. Keys MUST NOT be stored in browser `localStorage`, `.env` files, or the macOS Keychain. Keys are plain text on disk: any process running as the same macOS user can read them, and they are included in backups. The file MUST NOT be committed or shared. Keys saved for the removed Deepgram and Gemini providers MUST be dropped when the file is read.
- **SEC-002 (Zero Telemetry)**: The application MUST NOT send telemetry, analytics, crash logs, or heartbeat packets to any first-party or third-party tracking services.
- **SEC-003 (Local Ephemeral Processing)**: Audio PCM buffers MUST be processed in memory and discarded immediately following STT transcription. No raw audio files may be written to persistent storage.

### 3.3 Constraints
- **CON-001 (OS Compatibility)**: The native layer MUST target macOS 13.0 SDK or higher to access `ScreenCaptureKit` audio capture APIs.
- **CON-002 (RAM Budget)**: Total idle resident memory MUST NOT exceed 45MB. Peak memory during active embedded whisper transcription MUST NOT exceed 140MB.
- **CON-003 (CPU Budget)**: Active CPU utilization during an ongoing meeting MUST remain below 6% on Apple Silicon M-series processors.

### 3.4 Guidelines & Patterns
- **GUD-001 (Shared UI Tokens)**: Components MUST use the theme tokens (`sk-*` Tailwind colours backed by `--sk-*` CSS variables) and the `sk-*` classes in `src/index.css`, never raw palette colours: one surface style, concentric corner radii, an 11–14px type scale, accent for actions and focus, danger for recording and destructive actions, success for done, 14px icons, and no looping animations except a spinner while work is in progress.
- **GUD-002 (Motion)**: Motion MUST be quiet and quick: `.sk-pop` (160 ms enter via `@starting-style`, 120 ms exit via `usePresence`) for popups and status pieces, `.sk-fade` for text that changes often, transform and opacity only, popups growing from their trigger, no bounce or loops. Reduced motion MUST keep only opacity.
- **PAT-001 (Event-Driven IPC)**: High-frequency data (audio streams, STT chunks, LLM tokens) MUST be dispatched over Tauri event streams (`app.emit`) rather than polled commands.

## 4. Interfaces & Data Contracts

### 4.1 Tauri Native IPC Commands

```rust
// Window & Display Management
#[tauri::command]
fn set_click_through(enabled: bool) -> Result<(), String>; // forces pass-through everywhere (REQ-005)

#[tauri::command]
fn set_hit_regions(rects: Vec<[f64; 4]>); // visible UI as [x, y, w, h] in window points; the window takes the mouse only over these

#[tauri::command]
fn set_window_opacity(alpha: f64) -> Result<(), String>;

#[tauri::command]
fn set_layout_mode(mode: String) -> Result<(), String>; // "floating-hud" or "dynamic-notch"

#[tauri::command]
fn trigger_panic() -> Result<(), String>; // hides, wipes, deletes the session DB and quits the process; never returns

#[tauri::command]
fn hide_window() -> Result<(), String>; // hides and hands keyboard focus back (REQ-002)

#[tauri::command]
fn release_focus() -> Result<(), String>; // hands focus back to the previous app

#[tauri::command]
fn focus_for_typing() -> Result<(), String>; // makes Sidekick active so a text field can take keys

// Screen & Audio Capture
#[tauri::command]
fn capture_active_window() -> Result<WindowCaptureResponse, String>; // frontmost window other than Sidekick, at most 1280 px JPEG

#[tauri::command]
async fn start_audio_capture(config: Option<AudioCaptureConfig>) -> Result<(), String>; // only on user Start (REQ-018); off the main thread; idempotent

#[tauri::command]
async fn stop_audio_capture() -> Result<(), String>; // off the main thread; emits a final zero audio_level

// Config Store (API keys & settings, see SEC-001 and INF-001)
#[tauri::command]
fn store_api_key(provider: String, key: String) -> Result<(), String>; // empty key deletes; provider is 1-32 chars of a-z, 0-9, _ or -

#[tauri::command]
fn retrieve_api_key(provider: String) -> Result<String, String>; // "" when absent

#[tauri::command]
fn load_settings() -> Result<Option<String>, String>; // stored settings JSON, or null

#[tauri::command]
fn save_settings(settings: String) -> Result<(), String>; // "null" removes stored settings
```

### 4.2 Data Schemas

#### Live Options (Groq response, REQ-011)
The evaluator gets the last 12 turns as `Interviewer: …` / `Candidate: …` lines inside `<transcript>` delimiters and returns JSON mode output:
```json
{
  "asked": "How would you determine if a set of build targets with dependencies contains a circular dependency?",
  "likely": [
    "What is the time complexity of your solution?",
    "How would you handle a very large graph?",
    "Can you explain the difference between BFS and DFS here?"
  ]
}
```
`asked` is `null` when the interviewer's latest turn asks nothing. The client keeps at most one asked and three distinct likely questions; a null `asked` keeps the previous one pinned.

#### Listening Events (Rust → frontend, REQ-019)
```json
{ "event": "sidekick://audio_level", "payload": { "interviewer": 0.42, "candidate": 0.0 } }
{ "event": "sidekick://stt_error", "payload": { "message": "Groq rejected the API key.", "engine": "groq", "recovered": false, "timestamp": 1729000000000 } }
{ "event": "sidekick://pick_option", "payload": { "index": 0 } }
```

#### Progressive Disclosure Solution Schema
```json
{
  "question_id": "q_104928",
  "provider": "anthropic",
  "model": "claude-haiku-5-5",
  "stage_1_intuition": {
    "verbal_summary": "We implement a Redis-backed Sliding Window Counter. A pure fixed window allows twice the limit at window boundaries, while a sliding window log consumes too much memory for high-volume APIs. The sliding window counter strikes the optimal balance between accuracy and memory.",
    "key_tradeoffs": [
      "Sliding window counter provides ~99.5% accuracy with minimal O(1) memory per tenant",
      "Redis Lua script guarantees atomic check-and-increment operations without race conditions"
    ]
  },
  "stage_2_code": {
    "language": "python",
    "code": "import time\nimport redis\n\nclass SlidingWindowRateLimiter:\n    def __init__(self, r: redis.Redis, limit: int, window_sec: int):\n        self.r = r\n        self.limit = limit\n        self.window_sec = window_sec\n\n    def is_allowed(self, key: str) -> bool:\n        now = time.time()\n        current_bucket = int(now // self.window_sec)\n        # Atomic check and increment via Redis pipeline/Lua\n        ...\n        return True",
    "explanation": "Calculates weighted average of previous and current bucket request volumes to achieve smooth sliding-window protection."
  },
  "stage_3_analysis": {
    "time_complexity": "O(1) lookup and update per incoming request",
    "space_complexity": "O(N) where N is number of active unique tenant keys during window",
    "edge_cases": [
      "Redis node failover and replication lag",
      "Clock drift across application server instances",
      "Graceful degradation to local in-memory leaky bucket on cache partition"
    ]
  }
}
```

## 5. Acceptance Criteria

- **AC-001 (Screen Sharing Invisibility)**:
  - **Given** Sidekick overlay is active and visible on the user's monitor,
  - **When** the user shares their screen in Zoom, Google Meet, or Teams,
  - **Then** the meeting participants MUST NOT see the Sidekick window, and the background application or desktop wallpaper MUST be rendered in its place.

- **AC-002 (Panic Key Activation)**:
  - **Given** Sidekick is rendering live streamed code and transcribing audio,
  - **When** the user presses `Cmd + Esc`,
  - **Then** all overlay windows MUST become completely hidden within 25ms, audio capture MUST halt, in-flight HTTP streams MUST abort, the session database MUST be deleted, and the process MUST quit.

- **AC-003 (Frontmost Active Window Capture)**: Removed (16 Oct 2026). The `Cmd + Shift + S` shortcut no longer exists; see AC-008.

- **AC-004 (Live Options Latency)**:
  - **Given** a live meeting with a Groq key set,
  - **When** the interviewer finishes asking a question (0.8 s of silence ends the turn),
  - **Then** after transcription the question MUST appear in slot 1 marked "Asked" within about 1 s, with two likely next questions below it, and `Cmd + Option + 1` MUST start streaming its answer.

- **AC-005 (Embedded STT Offline Execution)**:
  - **Given** the host computer is placed in Airplane Mode (no internet connection),
  - **When** speech is received on the microphone with Embedded Whisper selected,
  - **Then** accurate text transcription MUST continue streaming to the overlay without network errors.

- **AC-006 (Progressive Disclosure Navigation)**:
  - **Given** the Deep Engine generates a solution,
  - **When** the response streams to the frontend,
  - **Then** Stage 1 (the short answer) MUST render first, followed by the Code row (expanded) and the Complexity row (collapsed), in one panel.

- **AC-007 (User-Controlled Meeting Capture)**:
  - **Given** Sidekick has launched and been summoned,
  - **When** the user has not pressed Start,
  - **Then** no audio MUST be captured; after Start the bar MUST show a recording indicator and timer, and after Stop, Panic or Burn capture MUST end.

- **AC-008 (Screen Toggle)**:
  - **Given** the Ask-box screen toggle is on (the default) and a window other than Sidekick is frontmost,
  - **When** the user sends a typed question,
  - **Then** that window MUST be captured silently, sent as a JPEG of at most 1280 px with the question, and the answer MUST show "Viewed screen". With the toggle off, nothing MUST be captured.

## 6. Test Automation Strategy

### 6.1 Test Levels & Frameworks
* **Unit Testing**:
  * *Rust Core*: `cargo test` verifying AppKit configuration wrappers, audio mixing buffers, and VAD silence thresholds.
  * *React Frontend*: Vitest + React Testing Library verifying state stores, progressive card expanders, and hotkey listeners.
* **Integration Testing**:
  * *Tauri IPC*: Mocked IPC invocations verifying command routing and event emissions.
  * *AI Dispatcher*: Provider integration tests with mock HTTP responses for OpenRouter, Anthropic and OpenAI.
* **End-to-End & Compliance Testing**:
  * *Invisibility Verification*: Automated QuickTime screen recording test script asserting pixel variance across captured frames to confirm 0% HUD leakage.

### 6.2 Test Automation in CI/CD
* GitHub Actions runner on `macos-14` (Apple Silicon M1/M2).
* Automated verification includes `cargo clippy`, `cargo test`, `npm run lint`, and Vitest test suite execution. Minimum code coverage requirement: 80% on core business logic.

## 7. Rationale & Context

### 7.1 Selection of Tauri v2 over Electron
Electron bundles a complete Chromium browser and Node.js runtime, producing ~180MB binary sizes and 150MB–300MB idle memory footprints. Tauri v2 utilizes the native macOS WebKit runtime (`WKWebView`) and Rust native threads, yielding ~15MB binary distribution and ~40MB RAM usage. This performance advantage ensures the host system remains cool and responsive during video calls.

### 7.2 Choice of Dual-Engine AI Architecture
* **Single Engine Failure Mode**: Using a frontier model (e.g. Claude 3.5 Sonnet) for live listening introduces 2–4s latency per conversational turn and high token costs. Conversely, using lightweight models exclusively leads to hallucinated or suboptimal algorithmic solutions during complex coding rounds.
* **Dual-Engine Balance**: Groq (`qwen/qwen3.8-27b`) produces live options per turn in about 0.4 s at near-zero cost, while the selected answer model is invoked only when the user picks an option or asks.

## 8. Dependencies & External Integrations

### 8.1 External Systems & APIs
- **EXT-001 (OpenRouter API)**: Unified OpenAI-compatible endpoint for multi-model access (`https://openrouter.ai/api/v1`).
- **EXT-002 (Anthropic Messages API)**: Native Claude endpoint supporting streaming and vision (`https://api.anthropic.com/v1/messages`).
- **EXT-003 (OpenAI Chat API)**: Direct OpenAI endpoint for GPT-6 Luna and GPT-6.1 Sol (`https://api.openai.com/v1/chat/completions`).
- **EXT-004 (Google Gemini API)**: Removed (16 Oct 2026). Gemini answers were dropped.
- **EXT-005 (Groq LPU Cloud)**: High-speed inference endpoint (`https://api.groq.com/openai/v1`) for live options (`qwen/qwen3.8-27b`) and optional Whisper transcription (`whisper-large-v3-turbo`). Groq answers were removed (16 Oct 2026).

### 8.2 Technology Platform Dependencies
- **PLT-001 (macOS 13.0+ SDK)**: Required for `ScreenCaptureKit` driverless system audio capture.
- **PLT-002 (Rust 1.78+)**: Required for Tauri v2 compilation and memory-safe audio stream processing.
- **PLT-003 (Node.js 20+)**: Required for frontend bundling with Vite.
- **PLT-004 (Apple Metal Toolchain)**: Required for GPU-accelerated local `whisper.cpp` inference.

### 8.3 Infrastructure & Local Storage Dependencies
- **INF-001 (Local Config File)**: Plain JSON file at `~/.config/sidekick/config.json` (or `$XDG_CONFIG_HOME/sidekick/config.json`) holding API keys and app settings. Writes are atomic (temp file + rename) and serialized by a lock. A corrupt file is renamed to `config.json.corrupt-<unix seconds>` and a fresh file is started. Unknown top-level keys are preserved. Settings saved by an older build in `localStorage` are moved into this file on first launch and then removed from `localStorage`. Burn Session does not touch this file; Reset Settings restores defaults and keeps API keys.
- **INF-002 (Local SQLite)**: Ephemeral storage for interview session logs with immediate purge capability.

## 9. Examples & Edge Cases

### 9.1 Invisibility Initialization (Rust / AppKit)
```rust
use cocoa::appkit::{NSWindow, NSWindowSharingType};
use cocoa::base::id;
use objc::runtime::YES;

pub fn configure_stealth_window(ns_window: id) {
    unsafe {
        // Exclude window from all screen sharing, recording, and capture APIs
        ns_window.setSharingType_(NSWindowSharingType::NSWindowSharingNone);
        
        // Ensure window floats above fullscreen spaces
        ns_window.setLevel_(cocoa::appkit::NSFloatingWindowLevel as i64);
        
        // Make background transparent
        ns_window.setOpaque_(cocoa::base::NO);
        ns_window.setBackgroundColor_(cocoa::appkit::NSColor::clearColor(cocoa::base::nil));
    }
}
```

### 9.2 Edge Cases
* **Screen Recording Permission Denied**: If the user denies macOS Screen Recording permission, screen capture and SCK audio fail. The app MUST catch `SCStreamError` gracefully and present a discreet diagnostic banner guiding the user to macOS System Settings.
* **Audio Device Disconnect**: If the user unplugs headphones mid-interview, `CoreAudio` stream listeners MUST automatically reconnect to the newly selected default output device within 500ms without crashing.
* **Rapid Fire Questions**: If the interviewer asks multiple questions back-to-back without pausing, the VAD queue MUST aggregate turns and extract the primary query rather than spawning competing AI streams.

## 10. Validation Criteria

1. **Invisibility Verification**: 100% absence in Zoom/Google Meet desktop shares verified via automated pixel analysis.
2. **Panic Reaction Speed**: Window hidden and network cancelled in < 25ms verified by high-precision performance timers.
3. **Capture Accuracy**: Frontmost window bounds cleanly extracted with 0 pixel bleed from background windows.
4. **Offline STT Integrity**: Audio correctly transcribed while computer is disconnected from the internet.
5. **Memory Constraint**: Resident set size under 45MB during idle state.

## 11. Related Specifications / Further Reading

* [Sidekick Architecture Plan Artifact](file:///Users/ashish/.gemini/antigravity/brain/b02c4b4b-18ce-4e99-8353-2c33b4f00470/SIDEKICK_ARCHITECTURE_PLAN.md)
* [Apple Developer: ScreenCaptureKit Audio Stream Documentation](https://developer.apple.com/documentation/screencapturekit)
* [Apple Developer: NSWindow.SharingType Documentation](https://developer.apple.com/documentation/appkit/nswindow/sharingtype)
* [Tauri v2 Documentation & Security Architecture](https://v2.tauri.app)
