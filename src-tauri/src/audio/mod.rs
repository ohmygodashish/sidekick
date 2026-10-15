//! Driverless Audio Ingestion Subsystem (REQ-007, REQ-008, CON-001, SEC-003)
//!
//! Dual-channel driverless audio capture and speaker diarization engine:
//! - Channel 0 (Interviewer): System and meeting audio via macOS ScreenCaptureKit.
//! - Channel 1 (Candidate): Local voice audio via default microphone (cpal / CoreAudio).
//! - Dual-channel mixer: 16kHz mono resampling, energy-based VAD with 1.1s turn silence detection.
//! - Ephemeral in-memory ring buffering with zero disk persistence (SEC-003).
//! - Sub-millisecond panic killswitch halt and buffer purge (REQ-004).

pub mod mic_audio;
pub mod mixer;
pub mod sck_audio;

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
}

/// Core audio state managed by Tauri runtime
pub struct AudioState {
    mixer: Arc<Mutex<AudioMixer>>,
    sck_stream: Arc<Mutex<Option<SckAudioCapture>>>,
    mic_stream: Arc<Mutex<Option<MicAudioCapture>>>,
    is_capturing: AtomicBool,
    is_panicked: AtomicBool,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            mixer: Arc::new(Mutex::new(AudioMixer::default())),
            sck_stream: Arc::new(Mutex::new(None)),
            mic_stream: Arc::new(Mutex::new(None)),
            is_capturing: AtomicBool::new(false),
            is_panicked: AtomicBool::new(false),
        }
    }
}

impl AudioState {
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

            match SckAudioCapture::start(TARGET_SAMPLE_RATE, move |samples, sample_rate, channels| {
                if let Ok(mut mixer) = mixer_clone.lock() {
                    if let Some(chunk) = mixer.process_samples(Channel::Interviewer, samples, sample_rate, channels) {
                        let _ = app_handle.emit(EVENT_AUDIO_TURN_COMPLETED, &chunk);
                    }
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

            match MicAudioCapture::start(move |samples, sample_rate, channels| {
                if let Ok(mut mixer) = mixer_clone.lock() {
                    if let Some(chunk) = mixer.process_samples(Channel::Candidate, samples, sample_rate, channels) {
                        let _ = app_handle.emit(EVENT_AUDIO_TURN_COMPLETED, &chunk);
                    }
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

    /// Synchronously halts all audio streams and purges memory buffers in < 5ms (REQ-004, SEC-003)
    pub fn purge(&self) {
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
    }
}

pub mod commands {
    use super::*;
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

        // Purge marks state panicked and clears streams
        state.purge();
        let snap2 = state.snapshot();
        assert!(snap2.is_panicked);
        assert!(!snap2.is_capturing);
    }
}
