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
  - [3.4 Live Options](#34-live-options)
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
- **Minimal Overlay**: One control bar at the top of the screen (Start/Stop meeting, Ask, Hide, and a menu). While a meeting is live, a caption and three live options sit under it, with one panel below for answers or settings. Clicks pass through everywhere except the visible pieces. Dark and light themes (Settings → General). Compact view leaves only the bar.
- **Driverless Dual-Channel Audio**: Simultaneously captures remote meeting audio via Apple's macOS 13+ `ScreenCaptureKit` and your microphone via CoreAudio—no virtual audio cables (BlackHole, Soundflower, Loopback) required.
- **On-Device Metal AI or Cloud Fallback**: Runs 100% offline Metal GPU-accelerated `whisper.cpp` transcription, with a one-click switch to Groq Whisper for cloud transcription.
- **Live Options**: While you talk, three numbered questions keep updating: the one the interviewer just asked (pinned in slot 1) and the ones they're likely to ask next. Press <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> or click one to get its answer.
- **Progressive Answers**: Answers stream from Anthropic, OpenAI or OpenRouter models into one panel: a short answer with key points, then expandable **Code** and **Complexity** rows. A box at the bottom takes typed questions and follow-ups, which keep the last six exchanges as context. <kbd>Cmd</kbd> + <kbd>Return</kbd> Assist answers from the screen and the recent conversation. Nothing is ever invented: a missing key, a provider error or a stalled stream shows a short error instead of an answer, and speech-to-text failures show in the caption instead of made-up words.
- **Local Key Storage**: API keys and settings live in a local config file (`~/.config/sidekick/config.json`, readable only by your macOS user). Session data is held in an ephemeral SQLite database that is deleted on panic or when you burn the session.

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
     │ • NSWindowSharingNone  │    │ • ScreenCaptureKit SCK │    │ • Groq live options     │
     │ • LSUIElement (No Dock)│    │ • CoreAudio Mic Input  │    │ • Multi-Provider Gateway│
     │ • Bar, Options & Panel │    │ • 0.8s VAD Chunker     │    │ • whisper.cpp (Metal)   │
     │ • Click pass-through   │    │ • Silent CGWindowGrab  │    │ • Progressive 3-Stage   │
     └────────────────────────┘    └────────────────────────┘    └─────────────────────────┘
```

---

## 2. The 8 Core Architectural Mandates

Sidekick strictly enforces eight architectural mandates defined in [`docs/spec-architecture-sidekick-copilot.md`](./docs/spec-architecture-sidekick-copilot.md):

| # | Mandate | Implementation Guarantee |
|:---:|:---|:---|
| **1** | **Screen-Share Invisibility** | All overlay windows assign `NSWindow.sharingType = .none` (`NSWindowSharingNone`). Screen capture frameworks composite whatever is behind Sidekick with 0% pixel bleed. |
| **2** | **Headless Phantom Operation** | Runs under `NSApplicationActivationPolicyAccessory` with `LSUIElement = true`. Zero Dock icon, zero Menu Bar tray, excluded from `Cmd + Tab`. Summoned exclusively via hotkeys, and showing it never takes focus from the app you are using. |
| **3** | **Minimal Overlay UX** | One draggable control bar (Start/Stop meeting, Ask, Hide, menu), a live caption and options while listening, and a single answer or settings panel. The window never resizes; Rust passes clicks through everywhere except the visible pieces. Opacity 15%–100%, click-through, dark/light themes, and a compact view that shows only the bar. |
| **4** | **Driverless Dual-Audio** | Ingests pristine system audio via macOS 13+ `ScreenCaptureKit` and candidate voice via microphone into discrete Channel 0 (Interviewer) and Channel 1 (Candidate). Zero drivers needed. |
| **5** | **Selectable STT** | Embedded Metal-accelerated `whisper.cpp` (`whisper-rs`) for 100% private offline transcription, with an instant Cloud STT toggle (Groq Whisper). |
| **6** | **Live Options** | After every transcript turn, one fast Groq call (`qwen/qwen3.8-27b` by default, about 0.4 s) returns the question just asked and three likely next questions. Without a Groq key, a local heuristic still spots asked questions. |
| **7** | **Multi-Provider Deep Engine** | Direct streaming integration for OpenRouter, Anthropic Direct, and OpenAI Direct with progressive disclosure rendering (Intuition $\rightarrow$ Code $\rightarrow$ Complexity). |
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
   - Press <kbd>Cmd</kbd> + <kbd>\\</kbd>. A control bar appears at the top-centre of the screen, just under the menu bar.
4. **Configure Your API Keys**:
   - Press <kbd>Cmd</kbd> + <kbd>,</kbd> (or open the **⋯** menu and choose **Settings**).
   - In the **General** tab, pick the answer provider (Anthropic, OpenAI or OpenRouter), enter its key and choose a model, then enter a Groq key for live options and fast transcription.
   - Keys save when you leave the field. They are written to `~/.config/sidekick/config.json` (see [3.7](#37-api-key--settings-storage)).
5. **Start a Meeting**:
   - Click **Start** in the bar, or press <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>\\</kbd>. Sidekick listens only while a meeting is live; the button then shows two level dots (sky = system audio, orange = microphone) and the elapsed time, and the caption and live options appear under the bar.
   - The first time, macOS asks for two permissions:
     - **Microphone**: your side of the conversation.
     - **Screen Recording**: required by macOS for `ScreenCaptureKit` audio capture and window capture.
   - If capture can't start, a message under the bar says so. Allow both permissions in **System Settings $\rightarrow$ Privacy & Security**, then click **Start** again (Screen Recording may need an app restart).
   - **Microphone and languages**: in **Settings $\rightarrow$ Audio**, pick the microphone (System default or a specific device) and use **Test** to check its level. Test does not transcribe. The same tab sets the transcription language and the language answers are written in.
   - Click **Stop** when the meeting ends.

---

### 3.2 The Hotkey Control System

Sidekick is operated through global keyboard shortcuts that work from any application, fullscreen IDE or virtual desktop space. Most work at all times. The ones marked *while visible* work only while Sidekick is showing:

| Shortcut | Action | User Purpose |
|:---|:---|:---|
| <kbd>Cmd</kbd> + <kbd>\\</kbd> | **Show or hide** | Always. Showing never takes focus from the app you are using. |
| <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>\\</kbd> | **Start or stop listening** | Always. Same as the **Start** and **Stop** buttons. |
| <kbd>Cmd</kbd> + <kbd>Esc</kbd> | **Panic** | Always. Hides at once, stops audio, wipes the buffers and deletes the session database, then quits Sidekick. No confirmation. |
| <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> | **Answer an option** | Always. Brings a hidden overlay back and answers live option 1, 2 or 3, with the recent conversation as context. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | **Click-through** | Always. Clicks pass through the overlay to the apps beneath it. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | **Compact view** | Always. Hides the answer panel and leaves only the control bar. Press again to bring the panel back. |
| <kbd>Cmd</kbd> + <kbd>Return</kbd> | **Assist** *(while visible)* | Answers from the screen and the recent transcript. In the Ask box with text, it sends the typed question instead. |
| <kbd>Cmd</kbd> + <kbd>R</kbd> | **New chat** *(while visible)* | Starts a new chat. The current thread stays in History. |
| <kbd>Cmd</kbd> + <kbd>,</kbd> | **Settings** *(while visible)* | Opens or closes the settings panel under the bar. |
| <kbd>Cmd</kbd> + <kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd> | **Move the window** *(while visible)* | 48 pt per press. Kept for the session only, and clamped so the bar stays on screen. |
| <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | **Scroll the answer** *(while visible)* | Scrolls the answer up or down, smoothly. |

While the *while visible* keys are registered, the focused app loses them: <kbd>Cmd</kbd> + <kbd>←</kbd>/<kbd>→</kbd> (line start and end), <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>↑</kbd>/<kbd>↓</kbd> (select to top or bottom), <kbd>Cmd</kbd> + <kbd>R</kbd> (reload), <kbd>Cmd</kbd> + <kbd>Return</kbd> (send) and <kbd>Cmd</kbd> + <kbd>,</kbd> (preferences). Hiding Sidekick gives them back. In the Ask box, <kbd>Return</kbd> sends and <kbd>Esc</kbd> closes the box and hands focus back. Every shortcut is listed in **Settings $\rightarrow$ Keybinds**.

Two older shortcuts were removed: <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> is now <kbd>Cmd</kbd> + <kbd>\\</kbd>, and <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> window capture is replaced by the screen toggles (see [3.6](#36-silent-problem-capture-vision)).

---

### 3.3 The Control Bar & Answer Panel

Sidekick shows one control bar at the top of the screen and, when there is something to show, one panel under it.

#### The control bar

| Button | What it does |
|:---|:---|
| **Start / Stop** | Starts or stops listening to the meeting (<kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>\\</kbd>). While live it shows two level dots (sky = system audio, orange = your microphone) and the elapsed time. Nothing is captured until you press **Start**. |
| **Ask** | Opens a box where you can type a question. <kbd>Return</kbd> sends it, and <kbd>Esc</kbd> closes it and hands focus back. Its screen toggle decides whether the screen goes with a typed question. |
| **Hide** (<kbd>Cmd</kbd> + <kbd>\\</kbd>) | Hides the overlay. Press the shortcut again to bring it back. |
| **⋯ menu** | Opacity (15%–100%), Mode (General, Behavioral, Coding, System Design or a custom mode), Compact view (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd>), Click-through (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>), Settings (<kbd>Cmd</kbd> + <kbd>,</kbd>), and Panic (<kbd>Cmd</kbd> + <kbd>Esc</kbd>). |

Start/Stop and Hide show their shortcut in a hover tooltip. Drag the bar by its empty space to move the overlay. It appears top-centre under the menu bar on every launch. Clicks anywhere outside the bar, caption, options and panel reach the app underneath; with click-through on (amber outline and pill) they pass through everything.

#### While listening
- **Caption**: two lines, **System** and **Microphone**, each with the latest transcribed sentence. A transcription problem (missing key, rejected key, no local model) shows here as a third line.
- **Live options**: see [3.4](#34-live-options).

#### The panel
- **Answer**: the question on one line, a short answer with key points, and expandable **Code** and **Complexity** rows. A box at the bottom takes typed questions and follow-ups. **✕** dismisses the answer and cancels it if it is still streaming.
- **Threads**: follow-ups stack in one thread, latest at the bottom, and see the last six exchanges as context. A pick or <kbd>Cmd</kbd> + <kbd>Return</kbd> Assist starts a new thread. The header has **New chat** (<kbd>Cmd</kbd> + <kbd>R</kbd>) and **History**, which lists this meeting's threads. Click one to reopen it. History is kept in memory only and is cleared on Stop, Burn Session and panic.
- **Settings**: opens in the same place. <kbd>Esc</kbd> or **✕** closes it.
- **Compact view** hides the panel and leaves only the bar.

---

### 3.4 Live Options

While a meeting is live, a card under the caption shows three numbered questions:

- **Before any question is asked**, all three are questions the interviewer is likely to ask next on the current topic. They update after every turn.
- **When the interviewer asks a question**, it takes slot 1, marked **Asked**, restated as one clear question. It stays pinned there until the next question is asked; slots 2 and 3 keep rolling.
- **To answer one**, click it or press <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>. The answer streams into the panel below, with the recent conversation as context. The picked option stays highlighted. Nothing is answered automatically.

How it works:
1. System audio (the interviewer) and your microphone are split into turns by voice activity detection (a turn ends after 0.8 s of silence, or at 15 s).
2. Each turn is transcribed (Groq Whisper or the local model) and shown in the caption.
3. After every turn, one Groq request sends the last 12 turns and gets back `{ "asked": …, "likely": [ … ] }`. One request runs at a time; turns that arrive meanwhile trigger one rerun with the latest transcript.
4. Without a Groq key, a local heuristic still spots asked questions in the interviewer's turns, but there are no predictions.

Example, from a test against Groq: after *"Say you have a bunch of build targets that depend on each other, how would you figure out if there's a circular dependency?"*, slot 1 became *"How would you determine if a set of build targets with dependencies contains a circular dependency?"*, with *"What is the time complexity of your solution?"* and *"How would you handle a very large graph?"* below it.

---

### 3.5 Multi-Provider Deep Intelligence & Progressive Disclosure

For a full answer, pick a live option (click, or <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>), or click **Ask** and type a question. Or press <kbd>Cmd</kbd> + <kbd>Return</kbd> (Assist) to answer from the screen and the recent conversation without typing. The box at the bottom of the panel takes follow-ups.

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

#### Models and thinking
Settings $\rightarrow$ **General** starts with **Appearance** (System, Light or Dark) and ends with a folded **Advanced** section (Burn session and Reset settings). In between are three parts:
- **Solution models**: pick Anthropic, OpenAI or OpenRouter. Only that provider's card shows: its API key and a model list. Each provider remembers its own model.
  - **Anthropic**: Claude Haiku 5.5 (default), Sonnet 5.5, Opus 5.5.
  - **OpenAI**: GPT-6 Luna (default), GPT-6.1 Sol.
  - **OpenRouter**: all five, with Haiku 5.5 as the default.
- **Thinking**: two switches and a level control how hard the answer model thinks.
  - **Think before answering** (on, at Medium by default) applies to typed questions and <kbd>Cmd</kbd> + <kbd>Return</kbd> Assist.
  - **Thinking level** (Low, Medium or High) sets how much the model thinks.
  - **Also think for picked options** (off by default) applies the same level to option picks and the background answer for the asked question. Off keeps picks fast.
  - Sonnet 5.5, Opus 5.5 and GPT-6.1 Sol can't turn thinking off. With them, both switches show on and greyed out, and every answer uses the chosen level. Your own switch settings come back when you pick Haiku 5.5 or GPT-6 Luna.
- **Evaluator model**: Groq with Qwen 3.8 27B, for live options. The Groq key is also used by Groq speech-to-text. To stop using Groq for speech, pick **On this Mac** in Audio.

Keys save when you leave the field and when Settings closes. If a provider refuses the thinking setting with an error, Sidekick retries the answer once without it.

#### Modes
Settings $\rightarrow$ **Modes**, or the **Mode** row in the ⋯ menu, sets how answers and live options are shaped:
- **General** (default): answers any question, with intuition, code when it helps, and complexity.
- **Behavioral**: STAR stories, a spoken first-person answer with four talking points.
- **Coding**: approach, then code, then complexity. The screen is on by default.
- **System Design**: requirements, components and trade-offs, with scaling limits.
- **Custom**: your own name and prompt. No files.

Resume and job description stay in **Profile** and apply to every mode.

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

Sidekick can answer from what is on your screen, such as a LeetCode problem, a HackerRank test or an architecture diagram in Google Meet. There is no capture shortcut. Screen toggles decide when the screen goes with a question:

- **Ask box**: on by default. A typed question includes the screen while the toggle is on.
- **Live options card**: off by default. A picked option includes the screen while the toggle is on. The Coding mode turns it on.
- **<kbd>Cmd</kbd> + <kbd>Return</kbd> Assist** always looks at the screen.

When a prompt uses the screen, Sidekick captures the frontmost window (never Sidekick itself) while the prompt is built, using native CoreGraphics APIs:
- **No crosshairs** appear on screen.
- **No camera shutter sound** plays.
- **No mouse interaction** required.
- Only that window's pixels are captured.
- The image is downscaled to at most 1280 px on its longest side and sent as a JPEG.

An answer that used the screen shows a small **Viewed screen** label.

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
  "settings": { "state": { "selectedProvider": "openrouter", "theme": "system", "…": "…" }, "version": 1 }
}
```

- **Permissions**: The folder is created with mode `0700` and the file with mode `0600`. Sidekick sets these again on every write.
- **Writes**: Each save writes a temp file and renames it over the old one. Writes are serialized with a lock.
- **Corrupt file**: If the file cannot be parsed, it is renamed to `config.json.corrupt-<unix seconds>` and Sidekick starts a fresh file. Unknown top-level keys are kept.
- **Settings**: Provider, models, speech-to-text engine, persona and tone, target company, job description, resume text, and layout preferences are stored in this file, not in browser storage. Settings saved by an older build are moved here automatically on first launch.
- **Retired providers**: Deepgram and Gemini keys saved by an older build are removed from the file when it is read.
- **Supported Providers**: Answers from **OpenRouter**, **Anthropic Direct** or **OpenAI Direct**; live options from **Groq Cloud**. Speech-to-text runs on this Mac or on Groq.
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
- Keys saved in the old Keychain were **not** migrated. Re-enter them once in **Settings → General**.
- Optionally, delete the old entries. Repeat for each provider (`openrouter`, `anthropic`, `openai`, `groq`):

```bash
security delete-generic-password -s com.sidekick.credentials -a openrouter
```

---

### 3.8 The Instant Panic Killswitch & Session Burner

If someone walks behind you, your interviewer asks you to share your entire desktop unexpectedly, or you want to wipe all session evidence immediately:

- **Panic Shortcut**: Press <kbd>Cmd</kbd> + <kbd>Esc</kbd>. There is no confirmation.
- **Response Time**: **< 25 milliseconds** to hide the overlay.
- **What Happens**:
  1. The overlay hides at once, and keyboard focus goes back to the app you were using.
  2. Audio capture stops and its buffers are wiped from memory.
  3. The session database (`session.db`) is deleted, with its files.
  4. Answers in progress are cancelled, and the thread History is cleared.
  5. Sidekick quits, so nothing of it stays running.
- **To use it again**: Relaunch Sidekick. Your API keys and settings in `~/.config/sidekick/config.json` are kept.

#### The "Burn Session" Button
Inside Settings (`Cmd + ,` $\rightarrow$ **General** $\rightarrow$ **Advanced**, folded at the bottom of the tab):
- Click the red **Burn** button, then click it again within 3 seconds to confirm. It:
  - Checkpoints and closes SQLite WAL files.
  - Drops all transcript turns, questions, and solution records.
  - Unlinks the physical `session.db` and temporary files from `~/Library/Application Support/Sidekick/`.
  - Clears all frontend Zustand state stores, including the thread History.
  - Ends the meeting and stops audio capture. Click **Start** to listen again.
  - Leaves your API keys and settings in `~/.config/sidekick/config.json` unchanged.
- **Reset** (also two clicks) restores default settings and keeps your API keys.

---

### 3.9 User Troubleshooting & FAQ

#### Q: I launched the app, but nothing appeared on screen?
> **A**: This is expected. Sidekick starts in headless phantom mode (`LSUIElement = true`) with initial visibility set to false. Press <kbd>Cmd</kbd> + <kbd>\\</kbd> to summon the overlay.

#### Q: Is Sidekick really invisible on Zoom and Google Meet?
> **A**: Yes. macOS AppKit provides `NSWindowSharingNone`, which instructs the Quartz WindowServer to exclude the window from all display capture streams. You can verify this yourself anytime by opening QuickTime Player $\rightarrow$ New Screen Recording or starting a private Zoom meeting and sharing your screen. Sidekick will not appear in the video stream.

#### Q: Do I need BlackHole or Loopback installed for audio capture?
> **A**: No. On macOS 13+, Sidekick uses Apple's native `ScreenCaptureKit` API to stream digital audio directly from running applications without kernel extensions or virtual audio devices.

#### Q: Can I run Sidekick completely offline?
> **A**: Speech-to-text can. In Settings $\rightarrow$ **Audio**, select **On this Mac** and click **Download model** (the tiny English model, about 75 MB). Transcription then runs locally on your Mac. Without a Groq key, live options fall back to a local heuristic that spots asked questions but can't predict the next ones, and full answers always need a cloud model provider.

#### Q: Will showing Sidekick take focus from my app?
> **A**: No. The overlay is a non-activating panel, so your app keeps the keyboard. Click into a text field in Sidekick (the Ask box or Settings) to type there. Sending, or pressing <kbd>Esc</kbd>, hands focus back to the app you were using.

#### Q: Why do <kbd>Cmd</kbd> + <kbd>R</kbd>, <kbd>Cmd</kbd> + <kbd>,</kbd> or <kbd>Cmd</kbd> + <kbd>←</kbd> stop working in my other app?
> **A**: While Sidekick is showing, it takes those keys for New chat, Settings and moving the window (see [3.2](#32-the-hotkey-control-system)). Hide Sidekick with <kbd>Cmd</kbd> + <kbd>\\</kbd> and they go back to your app.

#### Q: Why did Sidekick quit after <kbd>Cmd</kbd> + <kbd>Esc</kbd>?
> **A**: Panic is built to leave nothing behind. It wipes the meeting and the session database, then quits without asking. Relaunch Sidekick to use it again. Your keys and settings are kept.

#### Q: Does Sidekick send my screen to the AI?
> **A**: Only when a screen toggle is on, or for <kbd>Cmd</kbd> + <kbd>Return</kbd> Assist, which always looks at the screen. The frontmost window (never Sidekick itself) goes with that prompt to the answer provider you chose, as a JPEG of at most 1280 px. Keep the Ask-box and options toggles off to keep the screen out of typed and picked questions.

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
│   │   • useLiveOptions.ts          │   │   • HUDContainer.tsx      │   │
│   │   • useDeepSolver.ts           │   │   • ControlBar.tsx        │   │
│   │                                │   │   • AnswerPanel.tsx       │   │
│   └───────────────▲────────────────┘   │   • SettingsDrawer.tsx    │   │
│                   │                    └───────────────────────────┘   │
│   ┌───────────────┴────────────────┐                                   │
│   │       Services / AI Layer      │                                   │
│   │   • dispatcher.ts (Multi-LLM)  │                                   │
│   │   • streamParser.ts (XML/SSE)  │                                   │
│   │   • liveOptions.ts (Groq)      │                                   │
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
│   └── cluely-parity-plan.md       # Current decisions, shortcut map and phases
├── src/                            # React 19 Frontend Webview
│   ├── __tests__/                  # Vitest unit and integration test suites
│   ├── components/
│   │   ├── answer/                 # AnswerPanel (threads, Ask box, New chat), HistoryMenu
│   │   ├── cards/                  # ProgressiveCard, CodeBlock
│   │   ├── hud/                    # HUDContainer, ControlBar, BarMenu, LiveOptions, CaptionLine, ScreenToggle, Tip
│   │   └── settings/               # SettingsDrawer, ApiKeyInputs (General), ProfileEditor, ModesTab, MicSection, MicMeter
│   ├── hooks/                      # useDeepSolver, useLiveOptions, useFocusRelease, useHitRegions, useWarmup, prefetch, usePresence, useTheme
│   ├── lib/                        # Typed IPC bindings (ipc.ts) and classname utils (utils.ts)
│   ├── services/ai/                # LLM clients (Anthropic, OpenAI, OpenRouter), Groq live options, modes, prompt cache and thinking rules (reasoning.ts)
│   ├── store/                      # Zustand stores (appStore, sessionStore, settingsStore)
│   ├── App.tsx                     # Top-level shell: hooks, event listeners, and the HUD
│   ├── index.css                   # Theme tokens (dark and light), sk-* component classes, motion
│   └── main.tsx                    # React DOM entry point
└── src-tauri/                      # Rust 2021 Backend
    ├── capabilities/               # Tauri v2 permission definitions (default.json)
    ├── icons/                      # macOS bundle icons (.icns, .png)
    ├── src/
    │   ├── appkit/                 # Native window sharing, non-activating panel, window levels, accessory policy
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
    │   │   └── window_grab.rs      # CGWindowListCopyWindowInfo, 1280 px downscale and in-memory JPEG encoder
    │   ├── hotkeys/                # Global hardware shortcuts dispatcher
    │   │   └── mod.rs              # Panic, show/hide, listening, click-through, compact view, visible-only shortcuts, and Cmd+Option+1/2/3
    │   ├── hit_region.rs           # Cursor poller: click pass-through everywhere except the UI
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

#### Click Pass-Through Around the UI (`hit_region.rs`)
- **Location**: [`src-tauri/src/hit_region.rs`](file:///Users/ashish/Developer/sidekick/src-tauri/src/hit_region.rs), [`src/hooks/useHitRegions.ts`](file:///Users/ashish/Developer/sidekick/src/hooks/useHitRegions.ts)
- **Mechanism**: The overlay is one fixed transparent window (600 pt wide, the screen's work-area height, top-centre) that never resizes, because resizing a WKWebView repaints the page and makes the UI blink. The frontend reports the rects of every visible surface (`.sk-bar`, `.sk-panel`, `.sk-menu`, `.sk-surface`) with `set_hit_regions`, re-measuring on resize, mount and animation end. A Rust thread polls the cursor every 16 ms and calls `set_ignore_cursor_events` only when the answer changes, so the window takes the mouse only over the UI. Click-through mode (<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>) forces pass-through everywhere.

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
    - Compares the RMS energy of each slice with one threshold (`0.015`).
    - Detects turns with a **0.8-second turn silence threshold** (`REQ-011`, `AC-004`), and cuts any turn at 15 seconds.
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
  - Downscales the image so its longest edge is at most 1280 px, encodes it as JPEG (quality 0.8) in volatile memory, and returns a base64 data URL. It runs while a prompt is built, without emitting system capture sounds or displaying crosshairs.

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
| `set_click_through(enabled: bool) -> Result<(), String>` | Turns click-through mode on or off; the hit-region poller applies it within 16 ms. |
| `set_hit_regions(rects: Vec<[f64; 4]>)` | Reports the visible UI as `[x, y, width, height]` rects in window points. The window takes the mouse only over these. |
| `set_window_opacity(alpha: f64) -> Result<(), String>` | Updates native `NSWindow.alphaValue` (clamped 0.15 to 1.0). |
| `set_layout_mode(mode: String) -> Result<(), String>` | Saves the layout: `"floating-hud"` (bar and panel) or `"dynamic-notch"` (compact view, bar only). |
| `trigger_panic() -> Result<(), String>` | Hides the window, wipes audio buffers, deletes the session database and quits the process (< 25 ms to hide). Never returns. |
| `capture_active_window() -> Result<WindowCaptureResponse, String>` | Captures the frontmost window, other than Sidekick, at most 1280 px wide or tall, and returns it as a base64 JPEG data URL with the app and window names. Called when a prompt uses the screen. |
| `start_audio_capture(config: Option<AudioCaptureConfig>) -> Result<(), String>` | Async; starts dual-channel `ScreenCaptureKit` and microphone capture off the main thread. Called only when the user clicks **Start**; a second call while capturing is a no-op. |
| `stop_audio_capture() -> Result<(), String>` | Async; stops both streams off the main thread and emits a final zero `audio_level`. Called when the user clicks **Stop**. |
| `set_stt_engine(engine: String) -> Result<(), String>` | Switches STT engine (`"whisper_local"`, `"groq"`). |
| `download_stt_model(model_name: String) -> Result<(), String>` | Streams GGML weights from Hugging Face repository into local models dir. |
| `store_api_key(provider: String, key: String) -> Result<(), String>` | Saves or updates an API key in `config.json`. An empty key deletes it. `provider` must be 1–32 characters of `a-z`, `0-9`, `_` or `-`. |
| `retrieve_api_key(provider: String) -> Result<String, String>` | Reads an API key from `config.json`. Returns `""` when absent. |
| `load_settings() -> Result<Option<String>, String>` | Returns the stored settings JSON string, or `null` when none is stored. |
| `save_settings(settings: String) -> Result<(), String>` | Writes the settings JSON string to `config.json`. Passing `"null"` removes stored settings. |
| `burn_session() -> Result<(), String>` | Purges audio buffers and stops capture, then drops SQLite tables and unlinks database files. |
| `hide_window() -> Result<(), String>` | Hides the overlay and hands keyboard focus back to the previous app. |
| `release_focus() -> Result<(), String>` | Hands keyboard focus back to the previous app, for example when the user leaves a text field. |
| `focus_for_typing() -> Result<(), String>` | Makes Sidekick the active app so a text field can take the keyboard. |
| `list_input_devices() -> Result<Vec<InputDevice>, String>` | Lists the microphones for Settings $\rightarrow$ Audio. |
| `set_mic_device(name: Option<String>) -> Result<(), String>` | Chooses the microphone. `null` means the system default. |
| `set_stt_language(language: String) -> Result<Option<String>, String>` | Sets the transcription language. |
| `start_mic_test() -> Result<(), String>` / `stop_mic_test() -> Result<(), String>` | Runs the microphone meter for Settings $\rightarrow$ Audio $\rightarrow$ Test. No transcription. |

#### 2. Tauri Event Streams (Rust $\rightarrow$ Frontend)

| Event Identifier | Payload Schema | Purpose |
|:---|:---|:---|
| `sidekick://panic` | `{"action": "panic", "timestamp": u64}` | Emitted by <kbd>Cmd</kbd> + <kbd>Esc</kbd> just before the process quits. Cancels answers in progress. |
| `sidekick://visibility_toggled` | `{"visible": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>\\</kbd> shows or hides the overlay. |
| `sidekick://click_through_toggled`| `{"enabled": bool}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> toggles pass-through. |
| `sidekick://toggle_layout_mode` | `{"mode": "floating-hud" \| "dynamic-notch", "mode_str": String}` | Emitted when <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> toggles compact view. |
| `sidekick://active_window_captured`| `WindowCaptureResponse` | Emitted by `capture_active_window` each time a prompt captures the screen. |
| `sidekick://stt_chunk` | `{"id": String, "speaker": "interviewer"\|"candidate", "text": String, "is_final": bool}` | Emitted when an audio turn is transcribed. Never carries invented text. |
| `sidekick://stt_error` | `{"message": String, "engine": "groq"\|"whisper_local", "recovered": bool, "timestamp": u64}` | Emitted when a turn couldn't be transcribed, or (`recovered: true`) when a cloud failure was covered by the local model. The same message is sent at most once per 10 s. Shown in the caption. |
| `sidekick://audio_level` | `{"interviewer": f32, "candidate": f32}` | Live level per source, 0–1, at most every 100 ms while capturing. Drives the level dots. |
| `sidekick://pick_option` | `{"index": 0\|1\|2}` | Emitted by <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>; the frontend answers that live option. |
| `sidekick://session_burned` | none | Emitted when Burn Session purges the session database and memory buffers. |
| `sidekick://toggle_meeting` | `{}` | Emitted by <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>\\</kbd>. The frontend starts or stops listening. |
| `sidekick://open_settings` | `{}` | Emitted by <kbd>Cmd</kbd> + <kbd>,</kbd> while Sidekick is visible. |
| `sidekick://new_chat` | `{}` | Emitted by <kbd>Cmd</kbd> + <kbd>R</kbd> while Sidekick is visible. |
| `sidekick://assist` | `{}` | Emitted by <kbd>Cmd</kbd> + <kbd>Return</kbd> while Sidekick is visible. Sends the typed question, or answers from the screen. |
| `sidekick://scroll_answer` | `{"direction": "up" \| "down"}` | Emitted by <kbd>Shift</kbd> + <kbd>Cmd</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> while Sidekick is visible. |
| `sidekick://opacity_changed` | `{"opacity": number}` | Emitted when the window opacity changes. |
| `sidekick://mic_test_level` | `{"db": number, "peakDb": number}` | Meter readings while the microphone test runs. |

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

# Debug builds only: skip screen-share hiding and show the window at launch,
# so the UI can be screenshotted and tested
SIDEKICK_DEV_VISIBLE=1 npm run tauri -- dev
```

After changing `tailwind.config.js` (for example adding a theme token), restart the dev server; the running one keeps the old config.

---

### 4.6 Test Automation & Invisibility Verification

Sidekick enforces strict test automation across both Rust and React layers.

#### Running the Full Test Suite
```bash
# Run all Rust backend unit and integration tests (safe: they only write to temp directories;
# some read a local Whisper model if one is installed):
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
| **Panic Reaction Speed** | `< 25 ms` | Synchronous AppKit `hide()` first, then the process exits. |
| **Live Options Latency** | `≈ 1 s after a turn ends` | 0.8 s VAD silence ends the turn, then transcription, then one Groq call (≈ 0.4 s measured). One request in flight at a time. |
| **Pick or Assist to First Word** | `< 1.5 s` without the screen, `< 2.5 s` with it (target) | Measured ~1.6–2.4 s to the first word on OpenRouter + Haiku 5.5. Levers: warm connection at show and Start, 1-hour prompt cache, slot-1 background answer, downscaled screenshot. |
| **Zero Raw Audio Files** | `0 bytes` | In-memory volatile PCM buffers only. No audio writes to disk. |
| **Zero Telemetry** | `0 packets` | No analytics, crash reporters, or external tracking services. |
| **Local Key Storage** | `config.json` (`0600`) | All third-party API keys stored in `~/.config/sidekick/config.json`. Plain text on disk, protected by file permissions and FileVault. |

---

## 6. License & Legal Disclaimer

### License
This project is licensed under the [MIT License](LICENSE).

### Legal & Ethical Disclaimer
*Sidekick is designed as a private assistive copilot for practicing technical interview skills, reviewing live code syntax, organizing verbal presentation points, and augmenting personal workflow productivity. Users are solely responsible for complying with applicable regional wiretapping, audio recording consent laws (one-party vs. two-party consent jurisdictions), and employer or interview honor codes.*
