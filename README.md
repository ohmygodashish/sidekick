# Sidekick Copilot 🥷

> **Hyper-lightweight, screen-share invisible desktop copilot for macOS.**  
> Built for high-stakes technical interviews (coding, system design, behavioral), live pair-programming sessions, and private desktop intelligence.

[![macOS 13+](https://img.shields.io/badge/macOS-13.0%2B-blue?logo=apple)](https://developer.apple.com/macos/)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri)](https://v2.tauri.app/)
[![Rust 2021](https://img.shields.io/badge/Rust-1.78%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Tailwind CSS 3](https://img.shields.io/badge/Tailwind-v3-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Table of Contents

- [1. Product Overview & Key Features](#1-product-overview--key-features)
- [2. The 8 Core Architectural Mandates](#2-the-8-core-architectural-mandates)
- [3. User Guide & Operating Manual](#3-user-guide--operating-manual)
  - [3.1 Quick Start & First Launch](#31-quick-start--first-launch)
  - [3.2 The Hotkey Control System](#32-the-hotkey-control-system)
  - [3.3 The Control Bar & Answer Panel](#33-the-control-bar--answer-panel)
  - [3.4 Real-Time Live Question Detection & Quick Pointers](#34-real-time-live-question-detection--quick-pointers)
  - [3.5 Multi-Provider Deep Intelligence & Progressive Disclosure](#35-multi-provider-deep-intelligence--progressive-disclosure)
  - [3.6 Silent Problem Capture (Vision)](#36-silent-problem-capture-vision)
  - [3.7 API Key & Settings Storage](#37-api-key--settings-storage)
  - [3.8 The Instant Panic Killswitch & Session Burner](#38-the-instant-panic-killswitch--session-burner)
  - [3.9 User Troubleshooting & FAQ](#39-user-troubleshooting--faq)
- [4. Developer & Maintainer Guide](#4-developer--maintainer-guide)
  - [4.1 Architecture & Component Boundaries](#41-architecture--component-boundaries)
  - [4.2 Repository Directory Structure](#42-repository-directory-structure)
  - [4.3 Native macOS Subsystems](#43-native-macos-subsystems)
    - [AppKit Window Invisibility (`NSWindowSharingNone`)](#appkit-window-invisibility-nswindowsharingnone)
    - [Driverless Audio Ingestion (`ScreenCaptureKit` + CoreAudio)](#driverless-audio-ingestion-screencapturekit--coreaudio)
    - [Embedded Offline Metal STT (`whisper.cpp`)](#embedded-offline-metal-stt-whispercpp)
    - [Silent Active-Window Vision Grabber (`CoreGraphics Quartz`)](#silent-active-window-vision-grabber-coregraphics-quartz)
    - [API Key Config File & Ephemeral SQLite](#api-key-config-file--ephemeral-sqlite)
  - [4.4 Data Contracts & Event Streams (IPC Reference)](#44-data-contracts--event-streams-ipc-reference)
  - [4.5 Local Development Setup](#45-local-development-setup)
  - [4.6 Test Automation & Invisibility Verification](#46-test-automation--invisibility-verification)
  - [4.7 Production Packaging & Release Workflow](#47-production-packaging--release-workflow)
- [5. Performance & Security Invariants](#5-performance--security-invariants)
- [6. License & Legal Disclaimer](#6-license--legal-disclaimer)

---

## 1. Product Overview & Key Features

Sidekick is a desktop copilot that runs natively on macOS. Unlike browser extensions or generic AI desktop overlays that are easily captured during screen shares, Sidekick is engineered from the ground up at the OS kernel and window-server level to operate with **zero digital visibility**:

- **Invisible to Screen Sharing**: Never appears in Zoom, Google Meet, Microsoft Teams, Slack huddles, OBS Studio, Discord, or QuickTime Screen Recordings.
- **Headless Phantom Operation**: No Dock tile, no Menu Bar icon, and excluded from `Cmd + Tab`. You summon it purely through muscle-memory hardware hotkeys.
- **Minimal Overlay**: One control bar at the top of the screen (Start/Stop meeting, Ask, Hide, and a menu) with a single panel below it for answers or settings. Compact view hides the panel and leaves only the bar.
- **Driverless Dual-Channel Audio**: Simultaneously captures remote meeting audio via Apple's macOS 13+ `ScreenCaptureKit` and your microphone via CoreAudio—no virtual audio cables (BlackHole, Soundflower, Loopback) required.
- **On-Device Metal AI or Cloud Fallback**: Runs 100% offline Metal GPU-accelerated `whisper.cpp` transcription, with one-click toggles for Deepgram Nova-2 and Groq Whisper.
- **Live Question Detection (< 1s)**: Automatically detects when an interviewer concludes a question, strips filler pleasantries, and displays 3–4 punchy talking points in under 800ms.
- **Progressive Answers**: Answers stream from Anthropic, OpenAI, Gemini, or OpenRouter models into one panel: a short answer with key points, then expandable **Code** and **Complexity** rows. A box at the bottom takes typed questions and follow-ups.
- **Local Key Storage**: API keys and settings live in a local config file (`~/.config/sidekick/config.json`, readable only by your macOS user). Session data is held in an ephemeral SQLite database that is scrubbed on panic or single-click burn.

```
                    ┌────────────────────────────────────────────────────────┐
                    │                      Sidekick                          │
                    │               macOS Headless Phantom                   │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 │                              │                              │
     ┌───────────▼────────────┐    ┌────────────▼───────────┐    ┌─────────────▼───────────┐
     │   Stealth UI Layer     │    │   Audio & Vision Core  │    │  AI Intelligence Core   │
     │                        │    │                        │    │                         │
     │ • NSWindowSharingNone  │    │ • ScreenCaptureKit SCK │    │ • Groq LPU Detector     │
     │ • LSUIElement (No Dock)│    │ • CoreAudio Mic Input  │    │ • Multi-Provider Gateway│
     │ • Control Bar & Panel  │    │ • 1.1s VAD Chunker     │    │ • whisper.cpp (Metal)   │
     │ • Compact View         │    │ • Silent CGWindowGrab  │    │ • Progressive 3-Stage   │
     └────────────────────────┘    └────────────────────────┘    └─────────────────────────┘
```

---

## 2. The 8 Core Architectural Mandates

Sidekick strictly enforces eight architectural mandates defined in [`docs/spec-architecture-sidekick-copilot.md`](./docs/spec-architecture-sidekick-copilot.md):

| # | Mandate | Implementation Guarantee |
|:---:|:---|:---|
| **1** | **Screen-Share Invisibility** | All overlay windows assign `NSWindow.sharingType = .none` (`NSWindowSharingNone`). Screen capture frameworks composite whatever is behind Sidekick with 0% pixel bleed. |
| **2** | **Headless Phantom Operation** | Runs under `NSApplicationActivationPolicyAccessory` with `LSUIElement = true`. Zero Dock icon, zero Menu Bar tray, excluded from `Cmd + Tab`. Summoned exclusively via hotkeys. |
| **3** | **Minimal Overlay UX** | One draggable control bar (Start/Stop meeting, Ask, Hide, menu) with a single answer or settings panel below it. Opacity 15%–100%, click-through, and a compact view that shows only the bar. |
| **4** | **Driverless Dual-Audio** | Ingests pristine system audio via macOS 13+ `ScreenCaptureKit` and candidate voice via microphone into discrete Channel 0 (Interviewer) and Channel 1 (Candidate). Zero drivers needed. |
| **5** | **Selectable STT** | Embedded Metal-accelerated `whisper.cpp` (`whisper-rs`) for 100% private offline transcription, with instant Cloud STT toggles (Deepgram Nova-2 / Groq Whisper). |
| **6** | **Live Question Detection** | Real-time transcript evaluator extracts core questions and generates 3–4 instant talking points in < 1.0s (<100ms TTFT via Groq LPU / offline heuristic). |
| **7** | **Multi-Provider Deep Engine** | Direct streaming integration for OpenRouter, Anthropic Direct, OpenAI Direct, and Google Gemini Direct with progressive disclosure rendering (Intuition $\rightarrow$ Code $\rightarrow$ Complexity). |
| **8** | **Credential Security** | API keys and settings stored in a local JSON config file (`~/.config/sidekick/config.json`, mode `0600`). Ephemeral local SQLite database with instant < 25ms Panic killswitch and session burn. |

---

## 3. User Guide & Operating Manual

### 3.1 Quick Start & First Launch

1. **Install Sidekick**:
   - Download `Sidekick.dmg` from releases or build it via `scripts/build-macos.sh`.
   - Open `Sidekick.dmg` and drag `Sidekick.app` into `/Applications`.
2. **Launch Sidekick**:
   - Double-click `Sidekick.app`. 
   - **Notice**: No window opens immediately, and no icon bounces in the Dock or appears in the Menu Bar. This is intended phantom behavior.
3. **Summon Sidekick**:
   - Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd>. A control bar appears at the top of the screen.
4. **Configure Your API Keys**:
   - Press <kbd>Cmd</kbd> + <kbd>,</kbd> (or open the **⋯** menu and choose **Settings**).
   - In the **Keys** tab, enter your provider keys (Groq for fast question detection, Anthropic/OpenAI/Gemini/OpenRouter for full answers).
   - Click **Save keys**. Keys are written to `~/.config/sidekick/config.json` (see [3.7](#37-api-key--settings-storage)).
5. **Start a Meeting**:
   - Click **Start** in the bar. Sidekick listens only while a meeting is live; the button then shows a red stop square and the elapsed time.
   - The first time, macOS asks for two permissions:
     - **Microphone**: your side of the conversation.
     - **Screen Recording**: required by macOS for `ScreenCaptureKit` audio capture and window capture.
   - If capture can't start, a message under the bar says so. Allow both permissions in **System Settings $\rightarrow$ Privacy & Security**, then click **Start** again (Screen Recording may need an app restart).
   - Click **Stop** when the meeting ends.

---

### 3.2 The Hotkey Control System

Sidekick is operated completely through global hardware keyboard shortcuts that work from any application, fullscreen IDE, or virtual desktop space:

| Shortcut | Action | User Purpose |
|:---|:---|:---|
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | **Summon / Dismiss** | Toggle visibility of Sidekick overlay instantly. |
| <kbd>Cmd</kbd> + <kbd>Esc</kbd> | **Instant Panic Killswitch** | **Instant panic (< 25ms)**: Synchronously hides all windows, halts audio capture, and aborts active network streams. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | **Toggle Click-Through** | Enables mouse click pass-through. Allows clicking into your IDE, terminal, or browser directly through the overlay. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | **Toggle Compact View** | Hides the answer panel and leaves only the control bar. Press again to bring the panel back. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | **Silent Window Vision** | Silently captures the problem description/diagram from the frontmost coding window without crosshairs or sounds. |
| <kbd>Cmd</kbd> + <kbd>,</kbd> | **Settings** | Opens the settings panel (Keys, Profile, Audio, Danger) under the bar. |
| <kbd>Enter</kbd> or <kbd>Cmd</kbd> + <kbd>Enter</kbd> | **Ask** | Answers the detected question. Ignored while you type in a field or use a button or menu. With no question, the **Ask** button in the bar opens a box to type one. |

---

### 3.3 The Control Bar & Answer Panel

Sidekick shows one control bar at the top of the screen and, when there is something to show, one panel under it.

#### The control bar

| Button | What it does |
|:---|:---|
| **Start / Stop** | Starts or stops listening to the meeting. While live it shows a red stop square and the elapsed time. Nothing is captured until you press **Start**. |
| **Ask** (<kbd>Cmd</kbd> + <kbd>Enter</kbd>) | Answers the detected question. With no question, it opens a box where you can type one. |
| **Hide** (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd>) | Hides the overlay. Press the shortcut again to bring it back. |
| **⋯ menu** | Opacity (15%–100%), Compact view (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd>), Click-through (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>), Settings (<kbd>Cmd</kbd> + <kbd>,</kbd>), and Panic (<kbd>Cmd</kbd> + <kbd>Esc</kbd>). |

Drag the bar by its empty space to move the window.

#### The panel
- **Answer**: the question on one line, a short answer with key points, and expandable **Code** and **Complexity** rows. A box at the bottom takes typed questions and follow-ups. **✕** dismisses the answer and cancels it if it is still streaming.
- **Settings**: opens in the same place. <kbd>Esc</kbd> or **✕** closes it.
- **Compact view** hides the panel and leaves only the bar.

---

### 3.4 Real-Time Live Question Detection & Quick Pointers

During an interview, you don't always need full code—often, you need immediate verbal talking points within 1–2 seconds to begin answering smoothly.

1. **How it works**:
   - While a meeting is live, Channel 0 listens to incoming meeting audio via `ScreenCaptureKit`. Only this interviewer channel is checked for questions; your own speech never replaces the question.
   - Energy-based Voice Activity Detection (VAD) monitors speech turns. When the interviewer concludes an inquiry (1.1s silence detected), the turn buffer is dispatched.
   - The evaluator model (Groq LPU `llama-3.3-70b-versatile` or offline heuristic) strips conversational noise ("Um", "Yeah so basically", "Can you explain how...").
2. **What appears**:
   - The distilled, core technical question appears at the top of the answer panel.
   - **3–4 high-impact talking points / architectural keywords** appear below it. Press <kbd>Cmd</kbd> + <kbd>Enter</kbd> for a full answer.
   - Example:
     > **Interviewer**: *"Um, so I noticed your background with microservices. How would you handle distributed transactions across orders and payments?"*  
     > **Answer panel**:  
     > 🎯 *How to handle distributed transactions across orders and payments?*  
     > • **Two-Phase Commit (2PC)**: Strong consistency, blocking coordinator, single point of failure.  
     > • **Saga Pattern**: Choreography (event-driven) vs. Orchestration (central state machine).  
     > • **Compensating Transactions**: Semantic rollbacks for backward recovery.  
     > • **Outbox Pattern**: Atomic DB updates with Debezium/Kafka CDC to eliminate dual-write hazards.

---

### 3.5 Multi-Provider Deep Intelligence & Progressive Disclosure

For a full answer, press <kbd>Cmd</kbd> + <kbd>Enter</kbd> (or <kbd>Enter</kbd>) or click **Ask** in the bar. You can also type a question or follow-up in the box at the bottom of the panel.

The answer streams into one panel:

```
┌──────────────────────────────────────────────────────────────────┐
│ How would you design a rate limiter for a multi-tenant API?  ✕   │
│                                                                  │
│ Use a sliding-window counter in Redis, updated atomically by a   │
│ Lua script, with a local token bucket as a fallback.             │
│ • Sliding window balances memory against boundary spikes         │
│ • Lua keeps the update atomic without distributed locks          │
│                                                                  │
│ [</> Code · python                                          ▴]   │
│     class SlidingWindowRateLimiter: …                  [Copy]    │
│ [⏱ Complexity · O(1) time · O(N) space                       ▾]  │
│                                                                  │
│ [ Ask a follow-up…                                          ↵ ]  │
└──────────────────────────────────────────────────────────────────┘
```

- **Code** is expanded by default; click its row to collapse it. **Copy** puts the code on your clipboard.
- **Complexity** is collapsed by default; expand it to see edge cases.

#### Personalization Profiles
In Settings $\rightarrow$ **Profile** (`Cmd + ,`), configure:
- **Resume Context**: Paste your resume text, or drop a `.txt` or `.md` file (up to 200 KB). PDFs are not read; paste their text instead. Sidekick tailors suggestions to technologies and experiences you actually possess.
- **Job Description & Company**: Enter target company culture notes and tech stack requirements.
- **Seniority**: Junior, Mid, Senior, Staff, or Principal.
- **Tone**:
  - `Concise`: Short and direct.
  - `Balanced` (default): Clear, structured answers.
  - `Deep`: Thorough reasoning and edge cases.
  - `Staff`: Trade-offs and operational realities.
  - `Architect`: Systems, APIs, and scale.

Changes save automatically.

---

### 3.6 Silent Problem Capture (Vision)

When solving a LeetCode problem, HackerRank test, or reviewing a architecture diagram in Google Meet:

1. Bring the problem window to the foreground.
2. Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>.
3. Sidekick captures the exact bounds of the frontmost window using native CoreGraphics APIs:
   - **No crosshairs** appear on screen.
   - **No camera shutter sound** plays.
   - **No mouse interaction** required.
   - Zero pixel bleed from background windows.
4. Known gap: the shortcut's capture is not used yet. Every **Ask** takes its own screenshot of the frontmost window and sends it with the question to your configured model.

---

### 3.7 API Key & Settings Storage

Sidekick keeps your API keys and app settings in one plain JSON file in your home folder:

```text
~/.config/sidekick/config.json
```

If `XDG_CONFIG_HOME` is set to an absolute path, the file is at `$XDG_CONFIG_HOME/sidekick/config.json` instead.

The file looks like this:

```json
{
  "apiKeys": { "openrouter": "sk-or-…", "groq": "gsk_…" },
  "settings": { "state": { "selectedProvider": "openrouter", "…": "…" }, "version": 0 }
}
```

- **Permissions**: The folder is created with mode `0700` and the file with mode `0600`. Sidekick sets these again on every write.
- **Writes**: Each save writes a temp file and renames it over the old one. Writes are serialized with a lock.
- **Corrupt file**: If the file cannot be parsed, it is renamed to `config.json.corrupt-<unix seconds>` and Sidekick starts a fresh file. Unknown top-level keys are kept.
- **Settings**: Provider, models, speech-to-text engine, persona and tone, target company, job description, resume text, and layout preferences are stored in this file, not in browser storage. Settings saved by an older build are moved here automatically on first launch.
- **Supported Providers**: **OpenRouter**, **Anthropic Direct**, **OpenAI Direct**, **Google Gemini Direct**, **Groq Cloud**, and **Deepgram**.
- **Burn Session** does not touch this file. **Reset Settings** restores the default settings but keeps your API keys.

#### Editing, Backing Up, and Moving Keys
- **Edit by hand**: Quit Sidekick first. Otherwise the app can overwrite your change on its next save.
- **Back up**: Copy the file to a safe place. Keep the copy private.
- **Move to another Mac**: Copy the file, then run `chmod 600` on the copy.

#### Security Model
The file works like `~/.aws/credentials` or `~/.npmrc`:
- Keys are **plain text** on disk.
- Any process running as your macOS user can read the file.
- The file is included in Time Machine backups and in any dotfile sync of `~/.config`.
- FileVault encrypts the file at rest when the Mac is off or locked.
- Never commit or share `config.json`.

#### Why Not the Keychain
- No Keychain prompts after rebuilds, because ad-hoc signed builds change their signature.
- Keys are easy to edit, back up, and move.
- The storage code has no macOS-only dependency (the app itself is still macOS-only).
- `cargo test` no longer touches real credentials.

#### Upgrading from the Keychain Build
- Keys saved in the old Keychain were **not** migrated. Re-enter them once in **Settings → Keys**.
- Optionally, delete the old entries. Repeat for each provider (`openrouter`, `anthropic`, `openai`, `gemini`, `groq`, `deepgram`):

```bash
security delete-generic-password -s com.sidekick.credentials -a openrouter
```

---

### 3.8 The Instant Panic Killswitch & Session Burner

If someone walks behind you, your interviewer asks you to share your entire desktop unexpectedly, or you want to wipe all session evidence immediately:

- **Panic Shortcut**: Press <kbd>Cmd</kbd> + <kbd>Esc</kbd>.
- **Guaranteed Response Time**: **< 25 milliseconds**.
- **What Happens**:
  1. All overlay windows synchronously call `window.hide()`.
  2. `is_panicked` atomic flags trip to `true`.
  3. All in-flight LLM HTTP streaming connections abort immediately via `AbortController`.
  4. CoreAudio and ScreenCaptureKit audio ring buffers are flushed and zeroed in memory.
  5. The overlay vanishes completely from your screen.
  6. The meeting ends and audio capture stops. Click **Start** to listen again.
- **To unhide**: Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> once safe.

#### The "Burn Session" Button (Danger Zone)
Inside Settings (`Cmd + ,` $\rightarrow$ **Danger**):
- Click the red **Burn** button, then click it again within 3 seconds to confirm. It:
  - Checkpoints and closes SQLite WAL files.
  - Drops all transcript turns, questions, and solution records.
  - Unlinks the physical `session.db` and temporary files from `~/Library/Application Support/Sidekick/`.
  - Clears all frontend Zustand state stores.
  - Ends the meeting and stops audio capture. Click **Start** to listen again.
  - Leaves your API keys and settings in `~/.config/sidekick/config.json` unchanged.
- **Reset** (also two clicks) restores default settings and keeps your API keys.

---

### 3.9 User Troubleshooting & FAQ

#### Q: I launched the app, but nothing appeared on screen?
> **A**: This is expected. Sidekick starts in headless phantom mode (`LSUIElement = true`) with initial visibility set to false. Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> to summon the overlay.

#### Q: Is Sidekick really invisible on Zoom and Google Meet?
> **A**: Yes. macOS AppKit provides `NSWindowSharingNone`, which instructs the Quartz WindowServer to exclude the window from all display capture streams. You can verify this yourself anytime by opening QuickTime Player $\rightarrow$ New Screen Recording or starting a private Zoom meeting and sharing your screen. Sidekick will not appear in the video stream.

#### Q: Do I need BlackHole or Loopback installed for audio capture?
> **A**: No. On macOS 13+, Sidekick uses Apple's native `ScreenCaptureKit` API to stream digital audio directly from running applications without kernel extensions or virtual audio devices.

#### Q: Can I run Sidekick completely offline?
> **A**: Speech-to-text can. In Settings $\rightarrow$ **Audio**, select **On this Mac** and click **Download model** (the tiny English model, about 75 MB). Transcription then runs locally on your Mac. Question detection falls back to an offline heuristic when no Groq key is set, but full answers always need a cloud model provider.

---

## 4. Developer & Maintainer Guide

### 4.1 Architecture & Component Boundaries

Sidekick is built on **Tauri v2** using a hybrid architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                       React 19 Frontend Webview                        │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                         Zustand Stores                         │   │
│   │   • appStore.ts        • sessionStore.ts   • settingsStore.ts  │   │
│   └───────────────▲────────────────────────────────┬───────────────┘   │
│                   │                                │                   │
│   ┌───────────────┴────────────────┐   ┌───────────▼───────────────┐   │
│   │          Hooks Layer           │   │         UI Layer          │   │
│   │   • useQuestionDetector.ts     │   │   • HUDContainer.tsx      │   │
│   │   • useDeepSolver.ts           │   │   • ControlBar.tsx        │   │
│   │                                │   │   • AnswerPanel.tsx       │   │
│   └───────────────▲────────────────┘   │   • SettingsDrawer.tsx    │   │
│                   │                    └───────────────────────────┘   │
│   ┌───────────────┴────────────────┐                                   │
│   │       Services / AI Layer      │                                   │
│   │   • dispatcher.ts (Multi-LLM)  │                                   │
│   │   • streamParser.ts (XML/SSE)  │                                   │
│   │   • questionDetector.ts (Groq) │                                   │
│   └───────────────▲────────────────┘                                   │
│                   │                                                    │
├───────────────────┼────────────────────────────────────────────────────┤
│                   │ IPC Event Streams & Commands                       │
├───────────────────┼────────────────────────────────────────────────────┤
│                   ▼                                                    │
│                        Tauri v2 Rust Native Core                       │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                       IPC Command Router                       │   │
│   │   • lib.rs / main.rs                                           │   │
│   └──────┬────────────┬─────────────┬─────────────┬────────────┬───┘   │
│          │            │             │             │            │       │
│   ┌──────▼──────┐ ┌───▼───────┐ ┌───▼───────┐ ┌───▼──────┐ ┌───▼─────┐ │
│   │   appkit/   │ │  audio/   │ │  capture/ │ │ hotkeys/ │ │storage/ │ │
│   │             │ │           │ │           │ │          │ │         │ │
│   │ • window.rs │ │ • sck.rs  │ │ • window_ │ │ • mod.rs │ │•config  │ │
│   │ • accessory │ │ • mic.rs  │ │   grab.rs │ │          │ │•db.rs   │ │
│   │             │ │ • mixer.rs│ │           │ │          │ │         │ │
│   │             │ │ • whisper │ │           │ │          │ │         │ │
│   └─────────────┘ └───────────┘ └───────────┘ └──────────┘ └─────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 4.2 Repository Directory Structure

```text
sidekick/
├── scripts/
│   ├── test-invisibility.sh        # Automated screen-share invisibility & zero-pixel-bleed test
│   └── build-macos.sh              # Production build, codesign, and DMG packaging script
├── docs/
│   ├── spec-architecture-sidekick-copilot.md  # Core architectural specification
│   ├── implementation-plan.md      # Phased task-by-task engineering plan
│   └── audit.md                    # Code and design audit with current fix status
├── src/                            # React 19 Frontend Webview
│   ├── __tests__/                  # Vitest unit and integration test suites
│   ├── components/
│   │   ├── answer/                 # AnswerPanel (question, answer, follow-up box)
│   │   ├── cards/                  # ProgressiveCard, CodeBlock
│   │   ├── hud/                    # HUDContainer, ControlBar, BarMenu, OpacityControl
│   │   └── settings/               # SettingsDrawer, ApiKeyInputs, ProfileEditor
│   ├── hooks/                      # useDeepSolver, useQuestionDetector
│   ├── lib/                        # Typed IPC bindings (ipc.ts) and classname utils (utils.ts)
│   ├── services/ai/                # LLM clients (Anthropic, OpenAI, Gemini, OpenRouter, Groq)
│   ├── store/                      # Zustand stores (appStore, sessionStore, settingsStore)
│   ├── App.tsx                     # Top-level shell: hooks, event listeners, and the HUD
│   ├── index.css                   # Tailwind setup and the shared sk-* UI tokens
│   └── main.tsx                    # React DOM entry point
└── src-tauri/                      # Rust 2021 Backend
    ├── capabilities/               # Tauri v2 permission definitions (default.json)
    ├── icons/                      # macOS bundle icons (.icns, .png)
    ├── src/
    │   ├── appkit/                 # Native window sharing, window levels, accessory policy
    │   │   ├── mod.rs
    │   │   ├── window.rs           # NSWindowSharingNone, NSFloatingWindowLevel configuration
    │   │   └── accessory.rs        # NSApplicationActivationPolicyAccessory configuration
    │   ├── audio/                  # Audio capture, mixing, VAD, and transcription
    │   │   ├── mod.rs
    │   │   ├── sck_audio.rs        # ScreenCaptureKit Rust wrapper
    │   │   ├── sck_audio_bridge.h  # Objective-C ScreenCaptureKit bridge header
    │   │   ├── sck_audio_bridge.m  # Objective-C SCStream implementation
    │   │   ├── mic_audio.rs        # CoreAudio microphone capture via cpal
    │   │   ├── mixer.rs            # Dual-channel mixer, linear resampler, energy-based VAD
    │   │   ├── stt_dispatcher.rs   # Async worker queue, turn chunker, and STT router
    │   │   └── whisper.rs          # whisper-rs Metal inference and model download pipeline
    │   ├── bin/
    │   │   └── test_invisibility.rs # Native Quartz pixel-bleed verification binary
    │   ├── capture/                # Silent active-window vision capture
    │   │   ├── mod.rs
    │   │   └── window_grab.rs      # CGWindowListCopyWindowInfo and in-memory PNG encoder
    │   ├── hotkeys/                # Global hardware shortcuts dispatcher
    │   │   └── mod.rs              # Panic, visibility, layout, and capture shortcuts
    │   ├── storage/                # Security and persistence
    │   │   ├── mod.rs
    │   │   ├── config.rs           # API keys and settings in ~/.config/sidekick/config.json
    │   │   └── db.rs               # Ephemeral SQLite database and burn_session() engine
    │   ├── lib.rs                  # Tauri commands, state initialization, and lifecycle setup
    │   └── main.rs                 # Native binary entry point
    ├── build.rs                    # Objective-C bridge compilation with cc
    ├── Cargo.toml                  # Rust dependencies and release build profiles
    ├── Entitlements.plist          # macOS sandbox and privacy entitlements
    ├── Info.plist                  # LSUIElement=true configuration
    └── tauri.conf.json             # Tauri window geometry, security, and bundle targets
```

---

### 4.3 Native macOS Subsystems

#### AppKit Window Invisibility (`NSWindowSharingNone`)
- **Location**: [`src-tauri/src/appkit/window.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/appkit/window.rs)
- **Mechanism**: Immediately upon window creation in the Tauri setup hook, Sidekick grabs the raw `NSWindow` pointer (`window.ns_window()`) and invokes:
  ```rust
  ns_window.setSharingType_(NSWindowSharingType::NSWindowSharingNone);
  ns_window.setLevel_(cocoa::appkit::NSFloatingWindowLevel as i64);
  ns_window.setCollectionBehavior_(
      NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllSpaces
  );
  ns_window.setOpaque_(cocoa::base::NO);
  ns_window.setBackgroundColor_(cocoa::appkit::NSColor::clearColor(cocoa::base::nil));
  ```
- **Guarantees**:
  - `NSWindowSharingNone` (0): Completely excludes the window from all OS display capture APIs (`CGDisplayStream`, `ScreenCaptureKit`, QuickTime, and Zoom capture hooks).
  - `NSFloatingWindowLevel` (3): Floats above normal IDE and browser windows.
  - `NSWindowCollectionBehaviorFullScreenAuxiliary`: Ensures the window remains visible even when your IDE or conference call is in macOS Native Fullscreen spaces.

#### Driverless Audio Ingestion (`ScreenCaptureKit` + CoreAudio)
- **Location**: [`src-tauri/src/audio/sck_audio_bridge.m`](file:///Users/ashish/Developer/sidekick/src-tauri/src/audio/sck_audio_bridge.m), [`src-tauri/src/audio/mixer.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/audio/mixer.rs)
- **Mechanism**:
  - In Objective-C, Sidekick configures an `SCStream` with:
    ```objc
    SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
    config.capturesAudio = YES;
    config.excludesCurrentProcessAudio = YES;
    config.width = 2; // Minimal 2x2 raster footprint to consume 0% GPU
    config.height = 2;
    config.minimumFrameInterval = CMTimeMake(1, 1);
    ```
  - Incoming `CMSampleBufferRef` audio buffers are extracted to Linear PCM float32 slices and dispatched to a serial worker queue.
  - `mic_audio.rs` captures the default microphone via `cpal`.
  - `mixer.rs` downmixes and resamples both streams to **16kHz mono float32**.
  - **Voice Activity Detection (VAD)**:
    - Calculates RMS signal energy against configurable thresholds (`speech_threshold = 0.015`, `silence_threshold = 0.008`).
    - Detects turns with a **1.1-second turn silence threshold** (`REQ-011`, `AC-004`).
    - Employs a 150ms circular pre-roll buffer to prevent cutting off initial plosives and consonants.
    - Filters transient clicks (< 300ms speech bursts).

#### Embedded Offline Metal STT (`whisper.cpp`)
- **Location**: [`src-tauri/src/audio/whisper.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/audio/whisper.rs), [`src-tauri/src/audio/stt_dispatcher.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/audio/stt_dispatcher.rs)
- **Mechanism**:
  - Links `whisper-rs = { version = "0.14", features = ["metal"] }`.
  - Instantiates `WhisperContext` with `WhisperContextParameters { use_gpu: true }` on Apple Silicon.
  - **Asynchronous Worker Thread**: Audio turns from the mixer are dispatched to an `AsyncSttWorker` over a bounded cross-thread MPSC channel (`sync_channel(32)`). **Audio capture threads are never blocked by transcription inference.**
  - **Zero Raw Audio Files**: Buffers exist solely in memory as volatile `Vec<f32>` and are dropped immediately following transcription.

#### Silent Active-Window Vision Grabber (`CoreGraphics Quartz`)
- **Location**: [`src-tauri/src/capture/window_grab.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/capture/window_grab.rs)
- **Mechanism**:
  - Calls `CGWindowListCopyWindowInfo` to query all visible windows on screen.
  - Applies a comprehensive Z-order heuristic filter:
    - Excludes Sidekick's own process ID.
    - Excludes non-zero window layers (`kCGWindowLayer == 0` only).
    - Excludes invisible, minimized, or sub-50px tracking frames.
    - Excludes macOS system processes (`Window Server`, `Dock`, `SystemUIServer`, `Control Center`).
  - Grabs the frontmost candidate window using `CGWindowListCreateImage` with `kCGWindowImageBoundsIgnoreFraming`.
  - Encodes directly to PNG in volatile memory inside an explicit `autoreleasepool` and converts to base64. Operates in **< 60ms** without emitting system capture sounds or displaying crosshairs.

#### API Key Config File & Ephemeral SQLite
- **Location**: [`src-tauri/src/storage/config.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/storage/config.rs), [`src-tauri/src/storage/db.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/storage/db.rs)
- **Mechanism**:
  - `config.rs` reads and writes one JSON file, `~/.config/sidekick/config.json` (or `$XDG_CONFIG_HOME/sidekick/config.json`):
    - Top-level keys: `apiKeys` (provider to key) and `settings` (the persisted settings store).
    - Directory `0700`, file `0600`, re-applied on every write. Writes are atomic (temp file + rename) and serialized by a lock.
    - Corrupt files are renamed to `config.json.corrupt-<unix seconds>`. Unknown top-level keys are preserved.
    - `cargo test` does not touch real credentials.
  - `db.rs` wraps embedded SQLite with WAL journaling:
    - Located at `~/Library/Application Support/Sidekick/session.db`.
    - Supports atomic session eradication:
      ```rust
      pub fn burn_session(&self) -> Result<(), String> {
          // 1. Checkpoint WAL
          // 2. Drop all tables (session_turns, questions, solutions)
          // 3. VACUUM
          // 4. Unlink physical database files
      }
      ```

---

### 4.4 Data Contracts & Event Streams (IPC Reference)

#### 1. Tauri Commands (Frontend $\rightarrow$ Rust)

| Command Signature | Description |
|:---|:---|
| `set_click_through(enabled: bool) -> Result<(), String>` | Toggles mouse event pass-through on the native window. |
| `set_window_opacity(alpha: f64) -> Result<(), String>` | Updates native `NSWindow.alphaValue` (clamped 0.15 to 1.0). |
| `set_layout_mode(mode: String) -> Result<(), String>` | Saves the layout: `"floating_hud"` (bar and panel) or `"dynamic_notch"` (compact view, bar only). |
| `trigger_panic() -> Result<(), String>` | Synchronously hides all windows, aborts network, and flushes audio buffers (< 25ms). |
| `capture_active_window() -> Result<WindowCaptureResponse, String>` | Silently captures frontmost active window and returns Base64 PNG. |
| `start_audio_capture(config: Option<AudioCaptureConfig>) -> Result<(), String>` | Starts dual-channel `ScreenCaptureKit` and microphone capture. Called only when the user clicks **Start**. |
| `stop_audio_capture() -> Result<(), String>` | Stops audio capture streams. Called when the user clicks **Stop**. |
| `set_stt_engine(engine: String) -> Result<(), String>` | Switches STT engine (`"whisper_local"`, `"groq"`, `"deepgram"`). |
| `download_stt_model(model_name: String) -> Result<(), String>` | Streams GGML weights from Hugging Face repository into local models dir. |
| `store_api_key(provider: String, key: String) -> Result<(), String>` | Saves or updates an API key in `config.json`. An empty key deletes it. `provider` must be 1–32 characters of `a-z`, `0-9`, `_` or `-`. |
| `retrieve_api_key(provider: String) -> Result<String, String>` | Reads an API key from `config.json`. Returns `""` when absent. |
| `load_settings() -> Result<Option<String>, String>` | Returns the stored settings JSON string, or `null` when none is stored. |
| `save_settings(settings: String) -> Result<(), String>` | Writes the settings JSON string to `config.json`. Passing `"null"` removes stored settings. |
| `burn_session() -> Result<(), String>` | Purges audio buffers and stops capture, then drops SQLite tables and unlinks database files. |

#### 2. Tauri Event Streams (Rust $\rightarrow$ Frontend)

| Event Identifier | Payload Schema | Purpose |
|:---|:---|:---|
| `sidekick://panic` | `{"panicked": true, "timestamp": u64}` | Emitted when <kbd>Cmd</kbd> + <kbd>Esc</kbd> triggers instant panic. |
| `sidekick://visibility_toggled` | `{"visible": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> toggles visibility. |
| `sidekick://click_through_toggled`| `{"click_through": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> toggles pass-through. |
| `sidekick://toggle_layout_mode` | `{"layout_mode": String}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> toggles compact view. |
| `sidekick://active_window_captured`| `WindowCaptureResponse` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> captures a window. |
| `sidekick://stt_chunk` | `{"id": String, "speaker": "interviewer"\|"candidate", "text": String, "is_final": bool}` | Emitted when an audio turn is transcribed. |
| `sidekick://session_burned` | `{"burned": true, "timestamp": u64}` | Emitted when session database and memory buffers are purged. |

---

### 4.5 Local Development Setup

#### Toolchain Prerequisites
1. **Rust Stable**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   rustup default stable
   ```
2. **Node.js 20+ & npm**:
   ```bash
   # via fnm or nvm
   fnm install 24
   fnm use 24
   ```
3. **Xcode Command Line Tools & CMake**:
   ```bash
   xcode-select --install
   brew install cmake
   ```

#### Building & Running
```bash
# 1. Clone repository
git clone https://github.com/your-username/sidekick.git
cd sidekick

# 2. Install Node dependencies
npm install

# 3. Check Rust compilation
cargo check --manifest-path src-tauri/Cargo.toml

# 4. Run Vite webview dev server
npm run dev

# 5. Run full Tauri desktop application in development mode
npm run tauri -- dev
```

---

### 4.6 Test Automation & Invisibility Verification

Sidekick enforces strict test automation across both Rust and React layers.

#### Running the Full Test Suite
```bash
# Run all Rust backend unit and integration tests (safe: they only use temp directories):
cargo test --manifest-path src-tauri/Cargo.toml

# Run all React Vitest frontend unit tests:
npm test -- --run

# Run TypeScript typecheck and production Vite build:
npm run build
```

#### Automated Invisibility & Pixel-Bleed Verification
The repository contains an automated verification script that validates window invisibility against live macOS CoreGraphics Quartz APIs:

```bash
bash scripts/test-invisibility.sh
```

**What it tests**:
1. Inspects binary AST to verify `NSWindowSharingNone == 0` and `NSFloatingWindowLevel == 3`.
2. Verifies `LSUIElement == true` inside `src-tauri/Info.plist`.
3. Compiles and executes `src-tauri/src/bin/test_invisibility.rs`.
4. Creates a native Cocoa window with `sharingType = NSWindowSharingNone` and renders bright magenta pixels (`#FF00FF`).
5. Performs a live Quartz capture (`CGWindowListCreateImage`) over the exact window rectangle.
6. Asserts that **zero magenta pixels leak (0 / 160,000 pixels)**.
7. Instantiates a control window with `sharingType = NSWindowSharingReadOnly` and asserts that magenta pixels are captured (160,000 / 160,000 pixels), mathematically proving zero false positives.

---

### 4.7 Production Packaging & Release Workflow

Sidekick includes a single-command build and packaging script that generates a standalone `.app` bundle and installer `.dmg`:

```bash
bash scripts/build-macos.sh
```

#### Flags & Options
- `bash scripts/build-macos.sh`: Compiles for host architecture (e.g. Apple Silicon `aarch64-apple-darwin`).
- `bash scripts/build-macos.sh --universal`: Compiles universal Apple Silicon + Intel binary (`universal-apple-darwin`).

#### Build Pipeline Execution Steps
1. **Toolchain Preflight**: Checks `cargo`, `node`, `npm`, and `rustup`.
2. **Automated Test Gate**: Runs `cargo test` and `npm test`. Halts build on test failures.
3. **Frontend Compilation**: Builds production assets via `npm run build` (`tsc && vite build`).
4. **Rust Compilation**: Compiles release binary with LTO, 1 codegen unit, and symbol stripping (`strip = true`).
5. **Pre-DMG Codesigning**: Signs `Sidekick.app` bundle and embedded frameworks with ad-hoc signature (`codesign --force --deep -s -`).
6. **Installer Packaging**: Creates `Sidekick.dmg` with `hdiutil` and signs the resulting disk image.

#### Release Artifacts
```text
src-tauri/target/release/bundle/
├── macos/
│   └── Sidekick.app       # Standalone signed macOS application bundle
└── dmg/
    └── Sidekick.dmg       # Drag-and-drop macOS disk image installer
```

---

## 5. Performance & Security Invariants

All developers and contributors must adhere to these non-negotiable invariants:

| Metric / Invariant | Threshold | Enforcement |
|:---|:---|:---|
| **Idle Memory Footprint** | `< 45 MB` | Webview optimizations, lazy model loading, release profile LTO. |
| **Active Meeting CPU Utilization** | `< 6%` | Apple Silicon hardware Metal acceleration, 2x2 SCK footprint. |
| **Panic Reaction Speed** | `< 25 ms` | Synchronous AppKit `hide()`, non-blocking worker thread drops. |
| **Question Extraction Latency** | `< 1.0 s` | Groq LPU sub-100ms TTFT + 1.1s VAD silence window. |
| **Zero Raw Audio Files** | `0 bytes` | In-memory volatile PCM buffers only. No audio writes to disk. |
| **Zero Telemetry** | `0 packets` | No analytics, crash reporters, or external tracking services. |
| **Local Key Storage** | `config.json` (`0600`) | All third-party API keys stored in `~/.config/sidekick/config.json`. Plain text on disk, protected by file permissions and FileVault. |

---

## 6. License & Legal Disclaimer

### License
This project is licensed under the [MIT License](LICENSE).

### Legal & Ethical Disclaimer
*Sidekick is designed as a private assistive copilot for practicing technical interview skills, reviewing live code syntax, organizing verbal presentation points, and augmenting personal workflow productivity. Users are solely responsible for complying with applicable regional wiretapping, audio recording consent laws (one-party vs. two-party consent jurisdictions), and employer or interview honor codes.*
