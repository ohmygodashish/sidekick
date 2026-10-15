# Sidekick Copilot 🥷

> **Hyper-lightweight, screen-share invisible desktop copilot for macOS.**  
> Designed for high-stakes technical interviews, live pair-programming sessions, and private desktop intelligence.

---

## 1. Executive Overview & Core Architectural Mandates

Sidekick operates entirely outside standard desktop observability. It leaves zero visual footprint on video conferencing platforms, leaves no traces in the macOS Dock or menu bar, and processes live system and microphone audio without virtual sound drivers or kernel extensions.

### 🛡️ The 8 Core Mandates

1. **Screen-Share Invisibility (`NSWindowSharingNone`)**
   - The desktop overlay uses native macOS AppKit Quartz window sharing isolation (`sharingType = 0`).
   - The HUD is **100% invisible** to screen recordings and desktop sharing streams across Zoom, Google Meet, Microsoft Teams, Slack, OBS Studio, and QuickTime.
   - Screen capture APIs see directly through Sidekick to whatever window or desktop background lies beneath with **zero pixel bleed**.

2. **Headless Phantom Operation (`NSApplicationActivationPolicyAccessory`)**
   - Runs strictly with `LSUIElement = true` and `NSApplicationActivationPolicyAccessory`.
   - **Zero Dock icon**, **zero Menu Bar tray icon**, and completely excluded from the macOS `Cmd + Tab` app switcher.
   - Summoned, dismissed, and controlled purely via global low-latency hardware hotkeys.

3. **Dual Display UX (Floating Glassmorphic HUD + Dynamic Notch)**
   - **Floating Glassmorphic HUD**: Centered or repositionable semi-transparent window (`0.15` to `1.0` opacity slider) with click-through toggle (`Cmd + Shift + C`) allowing direct interaction with underlying IDEs or browser windows.
   - **Dynamic Notch Companion**: Seamlessly hugs the MacBook camera notch (`380px` to `720px` width) displaying live transcription pulses, speaker turn indicators, detected question badges, and progressive solution hints without taking up desktop space.

4. **Driverless Dual-Audio Ingestion (`ScreenCaptureKit` + `cpal`)**
   - Ingests pristine digital meeting audio directly from meeting participants via Apple's native `ScreenCaptureKit` framework (`SCStreamOutputTypeAudio`).
   - Concurrently captures the candidate's spoken microphone voice via `cpal` CoreAudio input streams.
   - **Zero virtual audio drivers** (BlackHole, Soundflower, Loopback) required.

5. **Metal-Accelerated Embedded STT + Cloud Fallback**
   - Offline, private transcription powered by embedded `whisper.cpp` compiled with Apple Metal GPU/Neural Engine acceleration.
   - Zero-install model downloader for official quantized GGML models (`tiny.en`, `base.en`, `small.en`).
   - Optional instant cloud STT toggle (Deepgram Nova-2 / Groq Whisper Large v3) for ultra-low latency transcription (< 300ms).

6. **Real-time Question Extractor & Quick Pointers (< 1s)**
   - Streaming transcript heuristic parser and background LLM detector that captures interview questions the moment they are asked.
   - Instantly generates 3 high-impact talking points and architectural trade-offs within 800ms to guide spontaneous verbal responses.

7. **Multi-Provider Deep Intelligence Gateway**
   - Direct streaming intelligence support for OpenRouter, Anthropic (`claude-3-5-sonnet`), OpenAI (`gpt-4o`, `o3-mini`), Google Gemini (`gemini-2.0-flash`, `gemini-1.5-pro`), and Groq.
   - Progressive 3-Stage Disclosure:
     - **Stage 1 (Intuition)**: High-level mental model, algorithm selection, and trade-offs.
     - **Stage 2 (Code)**: Syntax-highlighted code block with language selector and one-click clipboard copy (`Cmd + C`).
     - **Stage 3 (Analysis)**: Big-O Time & Space complexity badges and bulleted edge-case checklist.
   - Personalization injection: incorporates candidate resume, target job description, and chosen persona tone (Staff Engineer, Concise 3 Bullets, System Architect).

8. **Hardware-Backed Credential Isolation & Instant Ephemeral Burn**
   - Third-party API keys are stored exclusively in the macOS Keychain under the canonical service name `com.sidekick.credentials` via Apple's native `Security.framework`.
   - Active session telemetry, audio turns, questions, and progressive solutions reside in an ephemeral local SQLite database (`~/Library/Application Support/Sidekick/session.db`) with WAL journal mode.
   - One-click **"Burn Session"** (`Cmd + Esc` panic trigger or UI button) instantly halts streams, flushes audio ring buffers, deletes physical database files from disk, and resets state.

---

## 2. Global Hotkeys Reference

Sidekick registers hardware-level global shortcuts via `tauri-plugin-global-shortcut`. All shortcuts function globally across any focused application or fullscreen space:

| Shortcut | Action | Description |
|:---|:---|:---|
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> | **Toggle Visibility** | Summons or dismisses the Sidekick overlay instantly. |
| <kbd>Cmd</kbd> + <kbd>Esc</kbd> | **Panic Hide / Session Burn** | Instantly hides the overlay, mutes active processing, and purges transient audio buffers. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | **Toggle Click-Through** | Toggles mouse event pass-through (`ignoresMouseEvents`), allowing clicks to pass directly to underlying IDEs. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | **Toggle Layout Mode** | Switches between Floating Glassmorphic HUD and Dynamic Notch Companion. |
| <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> | **Silent Window Capture** | Silently grabs the active coding window/problem statement via CoreGraphics without shutter sounds. |
| <kbd>Cmd</kbd> + <kbd>,</kbd> | **Settings Drawer** | Opens the API key vault, personalization profile editor, model selector, and audio engine drawer. |

---

## 3. Project Architecture

```
sidekick/
├── scripts/
│   ├── test-invisibility.sh        # Automated screen-share invisibility & zero-pixel-bleed verification
│   └── build-macos.sh              # Single-command production build & DMG packager
├── src/                            # React 19 + TypeScript + Tailwind CSS Frontend
│   ├── components/
│   │   ├── cards/                  # ProgressiveCard, CodeBlock, ComplexityBadge
│   │   ├── hud/                    # HUDContainer, OpacityControl, LayoutSwitcher
│   │   ├── notch/                  # NotchCompanion, NotchAudioPulse
│   │   ├── question/               # QuestionBanner, QuickPointers
│   │   └── settings/               # SettingsDrawer, ApiKeyInputs, ProfileEditor
│   ├── hooks/                      # useDeepSolver, useAudioCapture
│   ├── lib/                        # IPC wrapper (safeInvoke)
│   ├── services/ai/                # Dispatcher (OpenRouter, Anthropic, OpenAI, Gemini, Groq)
│   └── store/                      # Zustand state stores (appStore, sessionStore, settingsStore)
└── src-tauri/                      # Rust 2021 + macOS AppKit Backend
    ├── src/
    │   ├── appkit/                 # NSWindowSharingNone, window levels, accessory policy
    │   ├── audio/                  # ScreenCaptureKit bridge, mic capture, mixer, VAD, whisper.cpp
    │   ├── capture/                # CoreGraphics silent active-window grab engine
    │   ├── hotkeys/                # Global shortcuts dispatcher and state snapshot
    │   ├── storage/                # macOS Keychain vault & local ephemeral SQLite database
    │   ├── bin/                    # test_invisibility verification runner
    │   └── lib.rs                  # Tauri commands and IPC router
    ├── Entitlements.plist          # Microphone, audio-input, screen-capture entitlements
    ├── Info.plist                  # LSUIElement=true phantom accessory configuration
    └── tauri.conf.json             # Window geometry, bundle identifiers, and target specs
```

---

## 4. Prerequisites & System Requirements

- **Operating System**: macOS 13.0 (Ventura), macOS 14.0 (Sonoma), or macOS 15.0+ (Sequoia).
- **Architecture**: Apple Silicon (M1/M2/M3/M4) recommended for Metal GPU STT acceleration; Intel x86_64 supported.
- **Toolchain**:
  - Rust 1.78+ (`rustup default stable`)
  - Node.js 18+ and `npm`
  - Xcode Command Line Tools (`xcode-select --install`)
  - CMake (required for compiling embedded whisper.cpp)

---

## 5. Development & Running

### Install Dependencies

```bash
# Clone the repository
git clone https://github.com/your-username/sidekick.git
cd sidekick

# Install frontend dependencies
npm install
```

### Run in Development Mode

```bash
npm run dev
```

Or run directly through Tauri CLI:

```bash
npm run tauri -- dev
```

When Sidekick starts:
1. It registers in headless phantom mode (no Dock icon).
2. Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> to reveal the Floating HUD.
3. Press <kbd>Cmd</kbd> + <kbd>,</kbd> to enter API keys for your preferred LLM provider.

---

## 6. Verification Suite

Sidekick includes an automated verification script that verifies screen-share invisibility and zero-pixel-bleed invariants against live AppKit and CoreGraphics Quartz capture APIs:

```bash
./scripts/test-invisibility.sh
```

The verification suite automatically:
1. Asserts that `NSWindowSharingNone == 0` in AppKit specifications.
2. Checks that `configure_stealth_window` enforces `NSWindowSharingNone` and `NSFloatingWindowLevel = 3`.
3. Verifies `LSUIElement = true` headless phantom activation in `Info.plist`.
4. Runs Rust AppKit unit tests.
5. Instantiates a live native `NSWindow` and performs an automated pixel scan over Quartz screen capture, asserting **zero pixel bleed (0 / 160,000 pixels leaked)**.

---

## 7. Standalone Production Build (`.app` and `.dmg`)

To compile an optimized, standalone release package and `.dmg` installer:

```bash
./scripts/build-macos.sh
```

This single-command script:
1. Validates the host environment and required toolchains.
2. Runs the complete test suite (Rust unit/integration tests + Vitest frontend specs).
3. Compiles the optimized React 19 frontend bundle.
4. Compiles the Rust backend with Apple Metal GPU optimizations enabled.
5. Packages both the `.app` bundle and standalone `.dmg` installer into `src-tauri/target/release/bundle/`.
6. Codesigns the application with an ad-hoc signature (`codesign --force --deep -s -`).

Artifact locations:
- **Application Bundle**: `src-tauri/target/release/bundle/macos/Sidekick.app`
- **Installer DMG**: `src-tauri/target/release/bundle/dmg/Sidekick.dmg`

To install or launch immediately:
```bash
open src-tauri/target/release/bundle/macos/Sidekick.app
```

---

## 8. Security & Privacy Guarantees

- **Zero Cloud Telemetry**: Sidekick sends zero telemetry or tracking requests to any external server.
- **Zero Local Footprint After Session Burn**: Clicking *"Burn Session"* or pressing <kbd>Cmd</kbd> + <kbd>Esc</kbd> clears all audio ring buffers from memory, zeroes out in-flight strings, truncates SQLite WAL checkpoints, and deletes database files.
- **Hardware Keychain Isolation**: All credentials are saved directly to macOS Keychain with OS-enforced access controls.
- **Driverless Capture**: Operates strictly within macOS user space via Apple's official `ScreenCaptureKit` and `CoreAudio` APIs without system modifications or root privileges.

---

## 9. License

MIT License. Built for candidates, engineers, and creators who value privacy and performance.
