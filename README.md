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
  - [3.3 Dual Display Modes (Floating HUD vs. Dynamic Notch)](#33-dual-display-modes-floating-hud-vs-dynamic-notch)
  - [3.4 Real-Time Live Question Detection & Quick Pointers](#34-real-time-live-question-detection--quick-pointers)
  - [3.5 Multi-Provider Deep Intelligence & Progressive Disclosure](#35-multi-provider-deep-intelligence--progressive-disclosure)
  - [3.6 Silent Problem Capture (Vision)](#36-silent-problem-capture-vision)
  - [3.7 Hardware Keychain Credential Security](#37-hardware-keychain-credential-security)
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
    - [Hardware Keychain & Ephemeral SQLite](#hardware-keychain--ephemeral-sqlite)
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
- **Natural Webcam Eye Contact**: Includes a **Dynamic Notch Companion** mode snapped directly below the MacBook camera lens so glancing at talking points aligns your gaze with the webcam.
- **Driverless Dual-Channel Audio**: Simultaneously captures remote meeting audio via Apple's macOS 13+ `ScreenCaptureKit` and your microphone via CoreAudio—no virtual audio cables (BlackHole, Soundflower, Loopback) required.
- **On-Device Metal AI or Cloud Fallback**: Runs 100% offline Metal GPU-accelerated `whisper.cpp` transcription, with one-click toggles for Deepgram Nova-2 and Groq Whisper.
- **Live Question Detection (< 1s)**: Automatically detects when an interviewer concludes a question, strips filler pleasantries, and displays 3–4 punchy talking points in under 800ms.
- **Progressive Disclosure Problem Solving**: Staged problem solving powered by Claude 3.5/3.7 Sonnet, GPT-4o, Gemini 2.0 Flash/Pro, or OpenRouter across three collapsible tiers: **Verbal Intuition $\rightarrow$ Clean Production Code $\rightarrow$ Complexity Analysis & Edge Cases**.
- **Hardware Security**: API keys live in your hardware-backed macOS Keychain (`com.sidekick.credentials`). Session data is held in an ephemeral SQLite database that is scrubbed on panic or single-click burn.

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
     │ • Floating Glass HUD   │    │ • 1.1s VAD Chunker     │    │ • whisper.cpp (Metal)   │
     │ • Dynamic Notch Pill   │    │ • Silent CGWindowGrab  │    │ • Progressive 3-Stage   │
     └────────────────────────┘    └────────────────────────┘    └─────────────────────────┘
```

---

## 2. The 8 Core Architectural Mandates

Sidekick strictly enforces eight architectural mandates defined in [`spec/spec-architecture-sidekick-copilot.md`](./spec/spec-architecture-sidekick-copilot.md):

| # | Mandate | Implementation Guarantee |
|:---:|:---|:---|
| **1** | **Screen-Share Invisibility** | All overlay windows assign `NSWindow.sharingType = .none` (`NSWindowSharingNone`). Screen capture frameworks composite whatever is behind Sidekick with 0% pixel bleed. |
| **2** | **Headless Phantom Operation** | Runs under `NSApplicationActivationPolicyAccessory` with `LSUIElement = true`. Zero Dock icon, zero Menu Bar tray, excluded from `Cmd + Tab`. Summoned exclusively via hotkeys. |
| **3** | **Dual Display UX** | Switchable between a draggable Glassmorphism HUD (15%–100% opacity, click-through) and a top-docked Dynamic Notch companion bar (optimized for webcam eye contact). |
| **4** | **Driverless Dual-Audio** | Ingests pristine system audio via macOS 13+ `ScreenCaptureKit` and candidate voice via microphone into discrete Channel 0 (Interviewer) and Channel 1 (Candidate). Zero drivers needed. |
| **5** | **Selectable STT** | Embedded Metal-accelerated `whisper.cpp` (`whisper-rs`) for 100% private offline transcription, with instant Cloud STT toggles (Deepgram Nova-2 / Groq Whisper). |
| **6** | **Live Question Detection** | Real-time transcript evaluator extracts core questions and generates 3–4 instant talking points in < 1.0s (<100ms TTFT via Groq LPU / offline heuristic). |
| **7** | **Multi-Provider Deep Engine** | Direct streaming integration for OpenRouter, Anthropic Direct, OpenAI Direct, and Google Gemini Direct with progressive disclosure rendering (Intuition $\rightarrow$ Code $\rightarrow$ Complexity). |
| **8** | **Credential Security** | All API keys stored in macOS Keychain via native `Security.framework`. Ephemeral local SQLite database with instant < 25ms Panic killswitch and session burn. |

---

## 3. User Guide & Operating Manual

### 3.1 Quick Start & First Launch

1. **Install Sidekick**:
   - Download `Sidekick.dmg` from releases or build it via `scripts/build-macos.sh`.
   - Open `Sidekick.dmg` and drag `Sidekick.app` into `/Applications`.
2. **Launch Sidekick**:
   - Double-click `Sidekick.app`. 
   - **Notice**: No window opens immediately, and no icon bounces in the Dock or appears in the Menu Bar. This is intended phantom behavior.
3. **Grant macOS Permissions**:
   - Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> to summon the HUD.
   - Sidekick requires two macOS permissions:
     - **Microphone**: Needed to ingest your candidate voice channel for diarization and STT.
     - **Screen Recording**: Required by macOS for `ScreenCaptureKit` audio capture and silent window vision capture.
   - If prompted by macOS, allow both permissions in **System Settings $\rightarrow$ Privacy & Security**.
4. **Configure Your API Keys**:
   - With the HUD open, press <kbd>Cmd</kbd> + <kbd>,</kbd> (or click the Settings gear icon).
   - Enter your preferred LLM provider key (Groq for sub-second questions, Anthropic/OpenAI/Gemini/OpenRouter for deep solving).
   - Click **Save API Keys**. Keys are securely locked into your macOS Keychain.

---

### 3.2 The Hotkey Control System

Sidekick is operated completely through global hardware keyboard shortcuts that work from any application, fullscreen IDE, or virtual desktop space:

| Shortcut | Action | User Purpose |
|:---|:---|:---|
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | **Summon / Dismiss** | Toggle visibility of Sidekick overlay instantly. |
| <kbd>Cmd</kbd> + <kbd>Esc</kbd> | **Instant Panic Killswitch** | **Instant panic (< 25ms)**: Synchronously hides all windows, halts audio capture, and aborts active network streams. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | **Toggle Click-Through** | Enables mouse click pass-through. Allows clicking into your IDE, terminal, or browser directly through the HUD. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | **Toggle Layout Mode** | Switches between Floating Glassmorphism HUD and Dynamic Notch Companion layout. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | **Silent Window Vision** | Silently captures the problem description/diagram from the frontmost coding window without crosshairs or sounds. |
| <kbd>Cmd</kbd> + <kbd>,</kbd> | **Settings Drawer** | Opens the API key vault, personalization profile editor, model selector, and audio engine drawer. |
| <kbd>Enter</kbd> or <kbd>Cmd</kbd> + <kbd>Enter</kbd> | **Deep Solve** | Triggers deep reasoning on the active question or captured screenshot. |
| <kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd> | **Stage Accordion** | Expands/collapses Stage 1 (Intuition), Stage 2 (Code), and Stage 3 (Complexity) on progressive solution cards. |

---

### 3.3 Dual Display Modes (Floating HUD vs. Dynamic Notch)

Sidekick offers two distinct display modes adapted to your interview style:

#### 1. Floating Glassmorphism HUD
- **Best for**: Live coding exercises, multi-monitor setups, and LeetCode algorithmic interviews.
- **Features**:
  - Freely draggable anywhere on screen using the top header handle (`data-tauri-drag-region`).
  - Smooth opacity slider (15% to 100%) so text remains legible over any background editor or dark mode IDE.
  - Interactive pass-through button (`⌘⇧C`) allowing you to type code into VS Code while hints remain hovering directly above your editor.

#### 2. Dynamic Notch Companion
- **Best for**: System design rounds, behavioral questions, and hiring manager conversations.
- **Features**:
  - Compact 380px pill layout anchored directly beneath the MacBook hardware webcam notch.
  - **Natural Eye Contact Guarantee**: Looking at the extracted question and talking points aligns your line of sight directly with your laptop's camera, projecting genuine, confident eye contact to the interviewer.
  - Live animated 5-bar audio waveform pulsing with speaker turn indicators (green for interviewer, blue for candidate).
  - Smooth downward expansion drawer when a question is detected or upon hover, with manual collapse overrides.

---

### 3.4 Real-Time Live Question Detection & Quick Pointers

During an interview, you don't always need full code—often, you need immediate verbal talking points within 1–2 seconds to begin answering smoothly.

1. **How it works**:
   - Channel 0 listens to incoming meeting audio via `ScreenCaptureKit`.
   - Energy-based Voice Activity Detection (VAD) monitors speech turns. When the interviewer concludes an inquiry (1.1s silence detected), the turn buffer is dispatched.
   - The evaluator model (Groq LPU `llama-3.3-70b-versatile` or offline heuristic) strips conversational noise ("Um", "Yeah so basically", "Can you explain how...").
2. **What appears**:
   - The distilled, core technical question pops up on the overlay.
   - **3–4 high-impact talking points / architectural keywords** appear in < 800ms.
   - Example:
     > **Interviewer**: *"Um, so I noticed your background with microservices. How would you handle distributed transactions across orders and payments?"*  
     > **Sidekick Question Banner**:  
     > 🎯 *How to handle distributed transactions across orders and payments?*  
     > • **Two-Phase Commit (2PC)**: Strong consistency, blocking coordinator, single point of failure.  
     > • **Saga Pattern**: Choreography (event-driven) vs. Orchestration (central state machine).  
     > • **Compensating Transactions**: Semantic rollbacks for backward recovery.  
     > • **Outbox Pattern**: Atomic DB updates with Debezium/Kafka CDC to eliminate dual-write hazards.

---

### 3.5 Multi-Provider Deep Intelligence & Progressive Disclosure

When you need an in-depth algorithmic solution or detailed system architecture, press **`Enter`** on the question banner or click **"Deep Solve"**.

Sidekick streams the answer in **three progressive stages**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 1: Verbal Intuition & Approach                     [Key: 1] ▾   │
├────────────────────────────────────────────────────────────────────────┤
│ • Redis Sliding Window Counter balances memory vs. boundary spikes.     │
│ • Lua script ensures atomicity without distributed locks.              │
└────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 2: Production-Grade Working Code                   [Key: 2] ▾   │
├────────────────────────────────────────────────────────────────────────┤
│  1  import time                                       [Python] [Copy]  │
│  2  class SlidingWindowRateLimiter:                                    │
│  3      def __init__(self, redis_client, limit: int, window_sec: int): │
│  4          self.r = redis_client                                      │
└────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 3: Complexity Analysis & Edge Cases                [Key: 3] ▾   │
├────────────────────────────────────────────────────────────────────────┤
│ Time: [O(1)]   Space: [O(N) active tenants]                           │
│ • Clock drift between server nodes                                     │
│ • Fallback to in-memory token bucket during Redis cluster partitions    │
└────────────────────────────────────────────────────────────────────────┘
```

- Press <kbd>1</kbd>, <kbd>2</kbd>, or <kbd>3</kbd> to expand or collapse each section independently.
- Press <kbd>Cmd</kbd> + <kbd>C</kbd> while viewing Stage 2 to copy clean, unadorned code directly to your clipboard.

#### Personalization Profiles
In the Settings Drawer (`Cmd + ,`), configure:
- **Resume Context**: Paste your resume text or drop your resume file. Sidekick tailors suggestions to technologies and experiences you actually possess.
- **Job Description & Company**: Enter target company culture notes and tech stack requirements.
- **Tone Presets**:
  - `Staff Engineer`: Pragmatic, production-ready, trade-off oriented.
  - `Concise 3 Bullets`: Punchy, ultra-high signal-to-noise ratio.
  - `System Architect`: Focuses on scalability, reliability, failure domains, and distributed systems fundamentals.

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
4. The high-resolution PNG is sent to your configured vision model (Claude 3.5/3.7 Sonnet, GPT-4o, Gemini 2.0 Pro) and solved progressively into Stage 1, 2, and 3.

---

### 3.7 Hardware Keychain Credential Security

Sidekick stores all API keys in the **macOS Keychain** using Apple's native `Security.framework` (`SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete`) under the canonical service identifier:

```text
com.sidekick.credentials
```

- Keys are **never** written to plaintext JSON files, `.env` files, or browser `localStorage`.
- All keys are loaded into volatile memory on launch and wiped upon process exit.
- Supported Providers: **OpenRouter**, **Anthropic Direct**, **OpenAI Direct**, **Google Gemini Direct**, **Groq Cloud**, and **Deepgram**.

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
  5. The HUD vanishes completely from your screen.
- **To unhide**: Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> once safe.

#### The "Burn Session" Button (Danger Zone)
Inside Settings (`Cmd + ,` $\rightarrow$ Danger Zone):
- Clicking the red **"Burn Session"** button executes an atomic eradication:
  - Checkpoints and closes SQLite WAL files.
  - Drops all transcript turns, questions, and solution records.
  - Unlinks the physical `session.db` and temporary files from `~/Library/Application Support/Sidekick/`.
  - Clears all frontend Zustand state stores.

---

### 3.9 User Troubleshooting & FAQ

#### Q: I launched the app, but nothing appeared on screen?
> **A**: This is expected. Sidekick starts in headless phantom mode (`LSUIElement = true`) with initial visibility set to false. Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> to summon the overlay.

#### Q: Is Sidekick really invisible on Zoom and Google Meet?
> **A**: Yes. macOS AppKit provides `NSWindowSharingNone`, which instructs the Quartz WindowServer to exclude the window from all display capture streams. You can verify this yourself anytime by opening QuickTime Player $\rightarrow$ New Screen Recording or starting a private Zoom meeting and sharing your screen. Sidekick will not appear in the video stream.

#### Q: Do I need BlackHole or Loopback installed for audio capture?
> **A**: No. On macOS 13+, Sidekick uses Apple's native `ScreenCaptureKit` API to stream digital audio directly from running applications without kernel extensions or virtual audio devices.

#### Q: Can I run Sidekick completely offline?
> **A**: Yes. In Settings $\rightarrow$ Audio, select **Embedded Whisper (Offline Metal)**. Download the `tiny.en` or `base.en` model via the settings drawer. STT will execute locally on your Apple Silicon GPU with zero internet connection.

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
│   │   • useDeepSolver.ts           │   │   • NotchCompanion.tsx    │   │
│   │   • useAudioCapture.ts         │   │   • ProgressiveCard.tsx   │   │
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
│   │ • window.rs │ │ • sck.rs  │ │ • window_ │ │ • mod.rs │ │•keychain│ │
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
├── spec/
│   ├── spec-architecture-sidekick-copilot.md  # Core architectural specification
│   └── implementation-plan.md      # Phased task-by-task engineering plan
├── src/                            # React 19 Frontend Webview
│   ├── __tests__/                  # Vitest unit and integration test suites (152 tests)
│   ├── components/
│   │   ├── cards/                  # ProgressiveCard, CodeBlock, ComplexityBadge
│   │   ├── hud/                    # HUDContainer, OpacityControl, LayoutSwitcher
│   │   ├── notch/                  # NotchCompanion, NotchAudioPulse
│   │   ├── question/               # QuestionBanner, QuickPointers
│   │   └── settings/               # SettingsDrawer, ApiKeyInputs, ProfileEditor
│   ├── hooks/                      # useDeepSolver, useQuestionDetector
│   ├── lib/                        # Typed IPC bindings (ipc.ts) and classname utils (utils.ts)
│   ├── services/ai/                # LLM clients (Anthropic, OpenAI, Gemini, OpenRouter, Groq)
│   ├── store/                      # Zustand stores (appStore, sessionStore, settingsStore)
│   ├── App.tsx                     # Top-level shell and layout router
│   ├── index.css                   # Tailwind styles and glassmorphism directives
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
    │   │   ├── keychain.rs         # macOS Security.framework generic password vault
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

#### Hardware Keychain & Ephemeral SQLite
- **Location**: [`src-tauri/src/storage/keychain.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/storage/keychain.rs), [`src-tauri/src/storage/db.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/storage/db.rs)
- **Mechanism**:
  - `keychain.rs` wraps native macOS `Security.framework`:
    - `SecItemAdd` / `SecItemUpdate` / `SecItemCopyMatching` / `SecItemDelete`.
    - Service: `com.sidekick.credentials`. Account: provider identifier (`"anthropic"`, `"openai"`, etc.).
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
| `set_layout_mode(mode: String) -> Result<(), String>` | Notifies backend of layout switch (`"floating_hud"` vs `"dynamic_notch"`). |
| `trigger_panic() -> Result<(), String>` | Synchronously hides all windows, aborts network, and flushes audio buffers (< 25ms). |
| `capture_active_window() -> Result<WindowCaptureResponse, String>` | Silently captures frontmost active window and returns Base64 PNG. |
| `start_audio_capture(config: AudioCaptureConfig) -> Result<(), String>` | Starts dual-channel `ScreenCaptureKit` and microphone capture. |
| `stop_audio_capture() -> Result<(), String>` | Stops audio capture streams and joins worker threads. |
| `set_stt_engine(engine: String) -> Result<(), String>` | Switches STT engine (`"whisper_local"`, `"groq"`, `"deepgram"`). |
| `download_stt_model(model_name: String) -> Result<(), String>` | Streams GGML weights from Hugging Face repository into local models dir. |
| `store_api_key(provider: String, key: String) -> Result<(), String>` | Saves or updates API key in macOS Keychain (`com.sidekick.credentials`). |
| `retrieve_api_key(provider: String) -> Result<String, String>` | Reads API key from macOS Keychain. |
| `burn_session() -> Result<(), String>` | Atomically drops SQLite tables, unlinks database files, and resets stores. |

#### 2. Tauri Event Streams (Rust $\rightarrow$ Frontend)

| Event Identifier | Payload Schema | Purpose |
|:---|:---|:---|
| `sidekick://panic` | `{"panicked": true, "timestamp": u64}` | Emitted when <kbd>Cmd</kbd> + <kbd>Esc</kbd> triggers instant panic. |
| `sidekick://visibility_toggled` | `{"visible": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> toggles visibility. |
| `sidekick://click_through_toggled`| `{"click_through": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> toggles pass-through. |
| `sidekick://toggle_layout_mode` | `{"layout_mode": String}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> flips HUD / Notch. |
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
# Run all Rust backend unit and integration tests (71 tests):
cargo test --manifest-path src-tauri/Cargo.toml

# Run all React Vitest frontend unit tests (152 tests across 13 suites):
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
| **Hardware Key Vault** | `Keychain` | All third-party secrets stored in `com.sidekick.credentials`. |

---

## 6. License & Legal Disclaimer

### License
This project is licensed under the [MIT License](LICENSE).

### Legal & Ethical Disclaimer
*Sidekick is designed as a private assistive copilot for practicing technical interview skills, reviewing live code syntax, organizing verbal presentation points, and augmenting personal workflow productivity. Users are solely responsible for complying with applicable regional wiretapping, audio recording consent laws (one-party vs. two-party consent jurisdictions), and employer or interview honor codes.*
