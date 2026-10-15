---
title: Sidekick Invisible Interview & Meeting Copilot Architecture Specification
version: 1.0.0
date_created: 2026-10-15
last_updated: 2026-10-16
owner: Sidekick Engineering Team
tags: [architecture, design, app, stealth, audio, ai, macos]
---

# Introduction

Sidekick is a hyper-lightweight, screen-share invisible desktop application for macOS built with Tauri v2 (Rust) and React 19. It acts as a real-time copilot during technical interviews (coding, system design, behavioral) and high-stakes meetings. It achieves zero-suspicion operation through OS-level window invisibility (`NSWindowSharingNone`), Dock/app-switcher concealment, instant silent active-window vision capture, driverless dual-audio ingestion (system meeting sound via `ScreenCaptureKit` + microphone), sub-second question detection with live talking points, and progressive disclosure problem solving powered by a multi-provider AI gateway (OpenRouter, Anthropic, OpenAI, Google Gemini) and embedded offline `whisper.cpp`.

## 1. Purpose & Scope

### 1.1 Purpose
This specification defines the architectural structure, component boundaries, data contracts, security constraints, and behavioral requirements for Sidekick. It provides the definitive standard for implementation, automated testing, and GenAI code generation.

### 1.2 Scope
* **Target Operating System**: macOS 13.0+ (Ventura, Sonoma, Sequoia) supporting Apple Silicon (M1/M2/M3/M4) and Intel architectures.
* **Core Capabilities**:
  * Screen-share invisibility preventing capture by Zoom, Google Meet, Microsoft Teams, Slack, Discord, QuickTime, and OBS.
  * System audio capture of meeting participants without virtual audio drivers (BlackHole/Loopback).
  * On-device speech-to-text using Metal-accelerated `whisper.cpp` alongside optional cloud STT toggles.
  * Real-time conversational question detection and instant talking-point generation (<100ms TTFT).
  * Frontmost active-window vision capture without manual crosshair selection.
  * Progressive disclosure solution rendering across 3 structured tiers (Intuition $\rightarrow$ Code $\rightarrow$ Complexity).
  * Multi-provider gateway for OpenRouter, Anthropic, OpenAI, and Google Gemini with API keys stored in a local config file (`~/.config/sidekick/config.json`, mode `0600`).
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
- **REQ-002 (Headless Phantom / Hotkey-Only Control)**: The application runtime MUST configure `NSApplicationActivationPolicyAccessory` before showing any UI, suppressing Dock icons and `Cmd + Tab` inclusion. Furthermore, the application MUST NOT register any system Status Bar item, Menu Bar icon, or System Tray icon. The application MUST be 100% headless with zero persistent visual footprint on the OS, summoned and dismissed purely via global hotkeys (`Cmd + Shift + Space` to toggle, `Cmd + Esc` to panic hide). Access to Application Settings MUST only be accessible from within the overlay UI (or via `Cmd + ,` while the overlay is visible) once summoned.
- **REQ-003 (Z-Index / Level)**: The overlay window MUST be assigned `NSWindow.Level.floating` and `NSWindowCollectionBehaviorFullScreenAuxiliary` to remain accessible above full-screen IDEs and video conference apps.
- **REQ-004 (Panic Shutdown)**: Global hotkey `Cmd + Esc` MUST synchronously hide all windows, terminate audio capture pipelines, abort in-flight network streams, and purge prompt buffers in <25ms.
- **REQ-005 (Click-Through Mode)**: Global hotkey `Cmd + Shift + C` MUST toggle `window.set_ignore_cursor_events(true/false)` to pass mouse events directly to background applications.
- **REQ-006 (Minimal Overlay UI)**: The user interface MUST consist of one control bar at the top of the window and one panel slot below it:
  - *Control bar*: Start/Stop meeting, Ask (`Cmd + Enter`), Hide (`Cmd + Shift + Space`), and a menu with opacity (15%–100%), compact view (`Cmd + Shift + M`), click-through (`Cmd + Shift + C`), settings (`Cmd + ,`) and panic (`Cmd + Esc`). The bar MUST be draggable (requires the `core:window:allow-start-dragging` capability).
  - *Panel*: shows either the answer (REQ-015) or settings, never both. Compact view (layout value `dynamic_notch`) hides the panel and leaves only the bar.
- **REQ-007 (Driverless Audio Ingestion)**: Meeting audio MUST be captured via `ScreenCaptureKit` system audio stream without requiring third-party kernel extensions or virtual audio cables. Candidate audio MUST be ingested via default microphone.
- **REQ-008 (Speaker Diarization)**: Ingested audio MUST be split into two discrete logical channels: Channel 0 (Interviewer / System) and Channel 1 (Candidate / Mic).
- **REQ-009 (Embedded Offline STT)**: The application MUST embed `whisper.cpp` compiled with Apple Metal support to perform 100% on-device speech transcription without external network requests.
- **REQ-010 (Cloud STT Option)**: The application MUST support toggling to Cloud STT (Deepgram Nova-2 / Groq Whisper) via user settings.
- **REQ-011 (Live Question Extraction)**: While a meeting is live (REQ-018), audio chunks from Channel 0 MUST be continuously analyzed by a fast evaluator model. Channel 1 (the candidate's own speech) MUST NOT replace the active question. When interrogative intent is detected:
  - Conversational filler and pleasantries MUST be stripped.
  - The distilled question MUST be rendered at the top of the answer panel.
  - 3–4 high-impact talking points MUST stream within <1.0s.
- **REQ-012 (On-Demand Deep Trigger)**: The user MUST be able to dispatch the active question to the Deep Intelligence Engine with `Enter` / `Cmd + Enter` or the Ask button. The shortcut MUST be ignored on key repeat and when focus is in a field, button, select, link, dialog or menu. With no active question, Ask MUST open a box where the user can type one; the same box MUST accept follow-up questions.
- **REQ-013 (Silent Active Window Capture)**: Global hotkey `Cmd + Shift + S` MUST identify the frontmost active window and capture its visual bounds without displaying crosshairs, drag frames, or emitting system capture sounds.
- **REQ-014 (Multi-Provider Deep Gateway)**: The Deep Intelligence Engine MUST support direct API integration for:
  - OpenRouter (Claude 3.5/3.7 Sonnet, DeepSeek R1/V3, Llama 3.3)
  - Anthropic Direct (Claude 3.5/3.7 Sonnet, Claude 3.5 Haiku)
  - OpenAI Direct (GPT-4o, GPT-4o-mini, o3-mini)
  - Google Gemini Direct (Gemini 2.0 Flash, Gemini 1.5 Pro)
- **REQ-015 (Progressive Disclosure Rendering)**: Output from the Deep Engine MUST render in one answer panel, in this order:
  1. *Stage 1*: a short answer with up to three key points, always visible.
  2. *Stage 2*: a Code row (syntax-highlighted, copyable), expanded by default.
  3. *Stage 3*: a Complexity row (Big-O and edge cases), collapsed by default.
  The previous answer MUST be cleared when a new solve starts, a working state MUST be shown while solving, errors MUST be shown with a Retry action, and closing the panel MUST cancel an in-flight solve.
- **REQ-016 (Personalization Profiles)**: The engine MUST incorporate user-provided resume text (pasted, or a `.txt`/`.md` file up to 200 KB; other formats, including PDF, are rejected with a message), job descriptions, seniority and tone (concise, balanced, deep, staff, system_architect) into the LLM system prompt.
- **REQ-017 (Session Wipe / Burn)**: The UI MUST provide a "Burn Session" command, confirmed by a second click within 3 seconds, that immediately purges local SQLite cache, memory buffers and temporary files, and ends the meeting. It MUST NOT touch the config file (SEC-001). "Reset Settings" MUST use the same two-click confirm and MUST keep API keys.
- **REQ-018 (User-Controlled Meeting Capture)**: Audio capture MUST NOT start at launch or on summon. It MUST start only when the user presses Start and stop when the user presses Stop; Panic (REQ-004) and Burn (REQ-017) MUST also end the meeting. While live, the control bar MUST show a recording indicator and the elapsed time. If starting or stopping fails, the error MUST be shown under the bar.

### 3.2 Security Requirements
- **SEC-001 (Credential Isolation)**: All third-party API keys (OpenRouter, Anthropic, OpenAI, Google, Groq, Deepgram) MUST be stored only in the local config file `~/.config/sidekick/config.json` (or `$XDG_CONFIG_HOME/sidekick/config.json` when `XDG_CONFIG_HOME` is an absolute path). The directory MUST be created with mode `0700` and the file MUST be written with mode `0600`, re-applied on every write. Keys MUST NOT be stored in browser `localStorage`, `.env` files, or the macOS Keychain. Keys are plain text on disk: any process running as the same macOS user can read them, and they are included in backups. The file MUST NOT be committed or shared.
- **SEC-002 (Zero Telemetry)**: The application MUST NOT send telemetry, analytics, crash logs, or heartbeat packets to any first-party or third-party tracking services.
- **SEC-003 (Local Ephemeral Processing)**: Audio PCM buffers MUST be processed in memory and discarded immediately following STT transcription. No raw audio files may be written to persistent storage.

### 3.3 Constraints
- **CON-001 (OS Compatibility)**: The native layer MUST target macOS 13.0 SDK or higher to access `ScreenCaptureKit` audio capture APIs.
- **CON-002 (RAM Budget)**: Total idle resident memory MUST NOT exceed 45MB. Peak memory during active embedded whisper transcription MUST NOT exceed 140MB.
- **CON-003 (CPU Budget)**: Active CPU utilization during an ongoing meeting MUST remain below 6% on Apple Silicon M-series processors.

### 3.4 Guidelines & Patterns
- **GUD-001 (Shared UI Tokens)**: Components MUST use the `sk-*` classes in `src/index.css`: one surface style, concentric corner radii, an 11–14px type scale, sky for actions and focus, red for recording and danger, emerald for success, 14px icons, and no looping animations except a spinner while work is in progress.
- **PAT-001 (Event-Driven IPC)**: High-frequency data (audio streams, STT chunks, LLM tokens) MUST be dispatched over Tauri event streams (`app.emit`) rather than polled commands.

## 4. Interfaces & Data Contracts

### 4.1 Tauri Native IPC Commands

```rust
// Window & Display Management
#[tauri::command]
fn set_click_through(enabled: bool) -> Result<(), String>;

#[tauri::command]
fn set_window_opacity(alpha: f64) -> Result<(), String>;

#[tauri::command]
fn set_layout_mode(mode: LayoutMode) -> Result<(), String>;

#[tauri::command]
fn trigger_panic() -> Result<(), String>;

// Screen & Audio Capture
#[tauri::command]
fn capture_active_window() -> Result<WindowCaptureResponse, String>;

#[tauri::command]
fn start_audio_capture(config: Option<AudioCaptureConfig>) -> Result<(), String>; // only on user Start (REQ-018)

#[tauri::command]
fn stop_audio_capture() -> Result<(), String>;

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

#### Question Extractor Event Schema (`sidekick://question_detected`)
```json
{
  "event": "sidekick://question_detected",
  "payload": {
    "question_id": "q_104928",
    "timestamp": 1729000000000,
    "confidence": 0.98,
    "raw_transcript": "Um, yeah, so I was wondering, how would you approach designing a rate limiter for a multi-tenant API?",
    "extracted_question": "How would you design a rate limiter for a multi-tenant API?",
    "quick_pointers": [
      "Token Bucket or Leaky Bucket algorithm",
      "Redis sliding window log using sorted sets (ZSET)",
      "Key schema: tenant_id:user_id:endpoint",
      "Ask interviewer: distributed vs single-node, hard vs soft throttling limits"
    ]
  }
}
```

#### Progressive Disclosure Solution Schema
```json
{
  "question_id": "q_104928",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
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
  - **Then** all overlay windows MUST become completely hidden within 25ms, audio capture MUST halt, and in-flight HTTP streams MUST abort.

- **AC-003 (Frontmost Active Window Capture)**:
  - **Given** a coding problem is open in Google Chrome or VS Code,
  - **When** the user presses `Cmd + Shift + S`,
  - **Then** Sidekick MUST capture the active window silently without camera sounds, crosshair overlays, or focus disruption, and forward the image to the configured Deep Engine.

- **AC-004 (Real-Time Question Detection Latency)**:
  - **Given** the interviewer concludes an interrogative statement,
  - **When** silence exceeding 1.1s is detected by VAD,
  - **Then** the extracted question and 3–4 punchy talking points MUST appear in the answer panel within 1.0s.

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

## 6. Test Automation Strategy

### 6.1 Test Levels & Frameworks
* **Unit Testing**:
  * *Rust Core*: `cargo test` verifying AppKit configuration wrappers, audio mixing buffers, and VAD silence thresholds.
  * *React Frontend*: Vitest + React Testing Library verifying state stores, progressive card expanders, and hotkey listeners.
* **Integration Testing**:
  * *Tauri IPC*: Mocked IPC invocations verifying command routing and event emissions.
  * *AI Dispatcher*: Provider integration tests with mock HTTP responses for OpenRouter, Anthropic, OpenAI, and Gemini.
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
* **Dual-Engine Balance**: Groq LPU / Llama 3.3 handles sub-second conversational turn-taking at near-zero cost, while Claude / GPT-4o / Gemini Pro is invoked on-demand for deep coding and system design.

## 8. Dependencies & External Integrations

### 8.1 External Systems & APIs
- **EXT-001 (OpenRouter API)**: Unified OpenAI-compatible endpoint for multi-model access (`https://openrouter.ai/api/v1`).
- **EXT-002 (Anthropic Messages API)**: Native Claude endpoint supporting streaming and vision (`https://api.anthropic.com/v1/messages`).
- **EXT-003 (OpenAI Chat API)**: Direct OpenAI endpoint for GPT-4o and o-series reasoning models (`https://api.openai.com/v1/chat/completions`).
- **EXT-004 (Google Gemini API)**: Generative Language endpoint for Gemini Flash and Pro (`https://generativelanguage.googleapis.com/v1beta`).
- **EXT-005 (Groq LPU Cloud)**: High-speed inference endpoint for Llama 3.3 70B (`https://api.groq.com/openai/v1`).

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
* **Screen Recording Permission Denied**: If the user denies macOS Screen Recording permission, active window capture and SCK audio fail. The app MUST catch `SCStreamError` gracefully and present a discreet diagnostic banner guiding the user to macOS System Settings.
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
