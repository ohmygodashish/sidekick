//! Driverless Audio Ingestion & Offline Speech-to-Text Subsystem (REQ-007, REQ-008, REQ-009, REQ-010, AC-005, NFR-3)
//!
//! Dual-channel driverless audio capture, diarization, and Metal-accelerated transcription:
//! - Channel 0 (Interviewer): System and meeting audio via macOS ScreenCaptureKit.
//! - Channel 1 (Candidate): Local voice audio via default microphone (cpal / CoreAudio).
//! - Dual-channel mixer: 16kHz mono resampling, energy-based VAD with 1.1s turn silence detection.
//! - Ephemeral in-memory ring buffering with zero disk persistence (SEC-003).
//! - Embedded Local Whisper engine (`whisper.rs`) with Apple Metal GPU acceleration (AC-005).
//! - Multi-engine STT dispatcher (`stt_dispatcher.rs`) routing to `whisper_local`, `groq`, or `deepgram`.
//! - Sub-millisecond panic killswitch halt and buffer purge < 25ms (REQ-004).

pub mod mic_audio;
pub mod mixer;
pub mod sck_audio;
pub mod stt_dispatcher;
pub mod whisper;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

pub use mic_audio::MicAudioCapture;
pub use mixer::{
    compute_rms, downmix_to_mono, resample_linear, AudioChannel, AudioChunk, AudioMixer, Channel,
    VadConfig, DEFAULT_RMS_THRESHOLD, DEFAULT_TURN_SILENCE_SECS, TARGET_SAMPLE_RATE,
};
pub use sck_audio::SckAudioCapture;
pub use stt_dispatcher::{
    channel_to_speaker, generate_turn_id, SttChunk, SttDispatcher, SttEngineType,
    EVENT_STT_CHUNK, EVENT_STT_ENGINE_CHANGED,
};
pub use whisper::{
    get_models_dir, is_metal_supported, list_available_models, resolve_model_path,
    LocalWhisperEngine, ModelAssetInfo, TranscriptionResult, WhisperConfig, WhisperEngine,
};

/// Tauri event names emitted to frontend
pub const EVENT_AUDIO_TURN_COMPLETED: &str = "sidekick://audio_turn_completed";
pub const EVENT_AUDIO_STATUS_CHANGED: &str = "sidekick://audio_status_changed";
pub const EVENT_AUDIO_LEVEL: &str = "sidekick://audio_level";

/// Configuration for starting audio capture
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioCaptureConfig {
    /// Ingest meeting audio (Channel 0: Interviewer) via ScreenCaptureKit
    pub capture_interviewer: bool,
    /// Ingest candidate microphone (Channel 1: Candidate)
    pub capture_candidate: bool,
    /// Turn silence threshold in seconds (default 1.1s, AC-004)
    pub vad_silence_secs: f32,
    /// Energy threshold for speech detection (default 0.015)
    pub vad_threshold: f32,
}

impl Default for AudioCaptureConfig {
    fn default() -> Self {
        Self {
            capture_interviewer: true,
            capture_candidate: true,
            vad_silence_secs: DEFAULT_TURN_SILENCE_SECS,
            vad_threshold: DEFAULT_RMS_THRESHOLD,
        }
    }
}

/// Snapshot of current audio capture engine state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioStateSnapshot {
    pub is_capturing: bool,
    pub is_interviewer_capturing: bool,
    pub is_candidate_capturing: bool,
    pub is_panicked: bool,
    pub stt_engine: String,
}

/// Core audio state managed by Tauri runtime
pub struct AudioState {
    mixer: Arc<Mutex<AudioMixer>>,
    sck_stream: Arc<Mutex<Option<SckAudioCapture>>>,
    mic_stream: Arc<Mutex<Option<MicAudioCapture>>>,
    dispatcher: Arc<SttDispatcher>,
    is_capturing: AtomicBool,
    is_panicked: AtomicBool,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            mixer: Arc::new(Mutex::new(AudioMixer::default())),
            sck_stream: Arc::new(Mutex::new(None)),
            mic_stream: Arc::new(Mutex::new(None)),
            dispatcher: Arc::new(SttDispatcher::default()),
            is_capturing: AtomicBool::new(false),
            is_panicked: AtomicBool::new(false),
        }
    }
}

impl AudioState {
    /// Creates a state with a custom STT dispatcher (useful for tests)
    pub fn with_dispatcher(dispatcher: Arc<SttDispatcher>) -> Self {
        Self {
            mixer: Arc::new(Mutex::new(AudioMixer::default())),
            sck_stream: Arc::new(Mutex::new(None)),
            mic_stream: Arc::new(Mutex::new(None)),
            dispatcher,
            is_capturing: AtomicBool::new(false),
            is_panicked: AtomicBool::new(false),
        }
    }

    /// Access the underlying STT dispatcher
    pub fn dispatcher(&self) -> &Arc<SttDispatcher> {
        &self.dispatcher
    }

    /// Takes an atomic snapshot of current audio engine state
    pub fn snapshot(&self) -> AudioStateSnapshot {
        let is_interviewer = self
            .sck_stream
            .lock()
            .map(|g| g.as_ref().map(|s| s.is_running()).unwrap_or(false))
            .unwrap_or(false);

        let is_candidate = self
            .mic_stream
            .lock()
            .map(|g| g.as_ref().map(|s| s.is_running()).unwrap_or(false))
            .unwrap_or(false);

        AudioStateSnapshot {
            is_capturing: self.is_capturing.load(Ordering::SeqCst),
            is_interviewer_capturing: is_interviewer,
            is_candidate_capturing: is_candidate,
            is_panicked: self.is_panicked.load(Ordering::SeqCst),
            stt_engine: self.dispatcher.get_engine().as_str().to_string(),
        }
    }

    /// Starts audio capture on both channels according to configuration
    pub fn start<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config: AudioCaptureConfig,
    ) -> Result<(), String> {
        // Reset panic state when explicitly starting audio capture
        self.is_panicked.store(false, Ordering::SeqCst);

        // 1. Configure audio mixer VAD
        let vad_config = VadConfig {
            threshold: config.vad_threshold,
            silence_threshold_secs: config.vad_silence_secs,
            min_speech_secs: 0.3,
            max_turn_secs: 15.0,
            pre_roll_secs: 0.15,
        };

        {
            let mut mixer_guard = self.mixer.lock().map_err(|e| e.to_string())?;
            *mixer_guard = AudioMixer::new(vad_config);
        }

        let mut errors = Vec::new();

        // 2. Channel 0: ScreenCaptureKit System Audio (Interviewer)
        if config.capture_interviewer {
            let mixer_clone = self.mixer.clone();
            let app_handle = app.clone();
            let dispatcher = self.dispatcher.clone();

            match SckAudioCapture::start(TARGET_SAMPLE_RATE, move |samples, sample_rate, channels| {
                // Task 9 Review Fix: Release mixer mutex BEFORE emitting IPC events and running STT inference
                let maybe_chunk = if let Ok(mut mixer) = mixer_clone.lock() {
                    mixer.process_samples(Channel::Interviewer, samples, sample_rate, channels)
                } else {
                    None
                };

                if let Some(chunk) = maybe_chunk {
                    let _ = app_handle.emit(EVENT_AUDIO_TURN_COMPLETED, &chunk);
                    dispatcher.dispatch_chunk(&chunk, &app_handle);
                }
            }) {
                Ok(sck) => {
                    let mut guard = self.sck_stream.lock().map_err(|e| e.to_string())?;
                    *guard = Some(sck);
                }
                Err(e) => {
                    eprintln!("[Sidekick Audio] ScreenCaptureKit startup warning: {e}");
                    errors.push(format!("ScreenCaptureKit: {e}"));
                }
            }
        } else {
            let mut guard = self.sck_stream.lock().map_err(|e| e.to_string())?;
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        // 3. Channel 1: Candidate Microphone Audio
        if config.capture_candidate {
            let mixer_clone = self.mixer.clone();
            let app_handle = app.clone();
            let dispatcher = self.dispatcher.clone();

            match MicAudioCapture::start(move |samples, sample_rate, channels| {
                // Task 9 Review Fix: Release mixer mutex BEFORE emitting IPC events and running STT inference
                let maybe_chunk = if let Ok(mut mixer) = mixer_clone.lock() {
                    mixer.process_samples(Channel::Candidate, samples, sample_rate, channels)
                } else {
                    None
                };

                if let Some(chunk) = maybe_chunk {
                    let _ = app_handle.emit(EVENT_AUDIO_TURN_COMPLETED, &chunk);
                    dispatcher.dispatch_chunk(&chunk, &app_handle);
                }
            }) {
                Ok(mic) => {
                    let mut guard = self.mic_stream.lock().map_err(|e| e.to_string())?;
                    *guard = Some(mic);
                }
                Err(e) => {
                    eprintln!("[Sidekick Audio] Microphone startup warning: {e}");
                    errors.push(format!("Microphone: {e}"));
                }
            }
        } else {
            let mut guard = self.mic_stream.lock().map_err(|e| e.to_string())?;
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        let snapshot = self.snapshot();
        let any_active = snapshot.is_interviewer_capturing || snapshot.is_candidate_capturing;
        self.is_capturing.store(any_active, Ordering::SeqCst);

        let _ = app.emit(
            EVENT_AUDIO_STATUS_CHANGED,
            serde_json::json!({
                "is_capturing": any_active,
                "is_interviewer_capturing": snapshot.is_interviewer_capturing,
                "is_candidate_capturing": snapshot.is_candidate_capturing,
                "stt_engine": snapshot.stt_engine,
                "warnings": errors,
            }),
        );

        // If both failed and were requested, return an error
        if !any_active && (!errors.is_empty()) {
            return Err(format!("Failed to start audio ingestion: {}", errors.join("; ")));
        }

        Ok(())
    }

    /// Stops audio capture across all streams and notifies frontend
    pub fn stop<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        self.is_capturing.store(false, Ordering::SeqCst);

        if let Ok(mut guard) = self.sck_stream.lock() {
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        if let Ok(mut guard) = self.mic_stream.lock() {
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        let _ = app.emit(
            EVENT_AUDIO_STATUS_CHANGED,
            serde_json::json!({
                "is_capturing": false,
                "is_interviewer_capturing": false,
                "is_candidate_capturing": false,
            }),
        );

        Ok(())
    }

    /// Synchronously halts all audio streams and purges memory buffers in < 25ms (REQ-004, SEC-003)
    pub fn purge(&self) {
        let start = std::time::Instant::now();
        self.is_panicked.store(true, Ordering::SeqCst);
        self.is_capturing.store(false, Ordering::SeqCst);

        if let Ok(mut guard) = self.sck_stream.lock() {
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        if let Ok(mut guard) = self.mic_stream.lock() {
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }

        if let Ok(mut mixer) = self.mixer.lock() {
            mixer.purge();
        }

        let elapsed = start.elapsed();
        if elapsed.as_millis() > 25 {
            eprintln!("[Sidekick Audio] Warning: AudioState::purge exceeded 25ms: {:?}", elapsed);
        }
    }
}

pub mod commands {
    use super::*;
    use std::str::FromStr;
    use tauri::State;

    /// Starts audio capture via ScreenCaptureKit (interviewer) and Microphone (candidate)
    #[tauri::command]
    pub fn start_audio_capture(
        app: AppHandle,
        state: State<'_, AudioState>,
        config: Option<AudioCaptureConfig>,
    ) -> Result<(), String> {
        state.start(&app, config.unwrap_or_default())
    }

    /// Halts active audio capture pipelines
    #[tauri::command]
    pub fn stop_audio_capture(
        app: AppHandle,
        state: State<'_, AudioState>,
    ) -> Result<(), String> {
        state.stop(&app)
    }

    /// Retrieves atomic audio capture status snapshot
    #[tauri::command]
    pub fn get_audio_capture_state(
        state: State<'_, AudioState>,
    ) -> Result<AudioStateSnapshot, String> {
        Ok(state.snapshot())
    }

    /// Sets the active Speech-to-Text inference engine
    #[tauri::command]
    pub fn set_stt_engine(
        app: AppHandle,
        state: State<'_, AudioState>,
        engine: String,
    ) -> Result<String, String> {
        let active = state.dispatcher.set_engine(&engine)?;
        let _ = app.emit(
            EVENT_STT_ENGINE_CHANGED,
            serde_json::json!({
                "engine": active,
                "label": SttEngineType::from_str(&active).map(|e| e.display_label()).unwrap_or(""),
            }),
        );
        Ok(active)
    }

    /// Retrieves the active Speech-to-Text inference engine identifier
    #[tauri::command]
    pub fn get_stt_engine(
        state: State<'_, AudioState>,
    ) -> Result<String, String> {
        Ok(state.dispatcher.get_engine().as_str().to_string())
    }

    /// Lists supported and available local STT model assets
    #[tauri::command]
    pub fn list_local_stt_models() -> Result<Vec<ModelAssetInfo>, String> {
        Ok(list_available_models())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_config_default() {
        let config = AudioCaptureConfig::default();
        assert!(config.capture_interviewer);
        assert!(config.capture_candidate);
        assert_eq!(config.vad_silence_secs, 1.1);
        assert_eq!(config.vad_threshold, 0.015);
    }

    #[test]
    fn test_audio_state_lifecycle_and_purge() {
        let state = AudioState::default();
        let snap = state.snapshot();
        assert!(!snap.is_capturing);
        assert!(!snap.is_interviewer_capturing);
        assert!(!snap.is_candidate_capturing);
        assert!(!snap.is_panicked);
        assert_eq!(snap.stt_engine, "whisper_local");

        // Measure purge duration (<25ms requirement per Task 9 review feedback)
        let purge_start = std::time::Instant::now();
        state.purge();
        let purge_duration = purge_start.elapsed();

        assert!(
            purge_duration.as_millis() < 25,
            "Purge took {:?}, must complete in < 25ms",
            purge_duration
        );

        let snap2 = state.snapshot();
        assert!(snap2.is_panicked);
        assert!(!snap2.is_capturing);
    }

    #[test]
    fn test_audio_state_dispatcher_engine_change() {
        let state = AudioState::default();
        assert_eq!(state.snapshot().stt_engine, "whisper_local");

        state.dispatcher.set_engine("groq").unwrap();
        assert_eq!(state.snapshot().stt_engine, "groq");

        state.dispatcher.set_engine("deepgram").unwrap();
        assert_eq!(state.snapshot().stt_engine, "deepgram");
    }
}
