//! Driverless Audio Ingestion & Offline Speech-to-Text Subsystem (REQ-007, REQ-008, REQ-009, REQ-010, AC-005, NFR-3)
//!
//! Dual-channel driverless audio capture, diarization, and Metal-accelerated transcription:
//! - Channel 0 (Interviewer): System and meeting audio via macOS ScreenCaptureKit.
//! - Channel 1 (Candidate): Local voice audio via default microphone (cpal / CoreAudio).
//! - Dual-channel mixer: 16kHz mono resampling, energy-based VAD with 1.1s turn silence detection.
//! - Ephemeral in-memory ring buffering with zero disk persistence (SEC-003).
//! - Embedded Local Whisper engine (`whisper.rs`) with Apple Metal GPU acceleration (AC-005).
//! - Multi-engine STT dispatcher (`stt_dispatcher.rs`) routing to `whisper_local`, `groq`, or `deepgram`.
//! - Asynchronous decoupled worker thread (`AsyncSttWorker`) ensuring ZERO audio callback thread blocking.
//! - Sub-millisecond panic killswitch halt and buffer purge < 25ms (REQ-004).

pub mod mic_audio;
pub mod mixer;
pub mod sck_audio;
pub mod stt_dispatcher;
pub mod whisper;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub use mic_audio::MicAudioCapture;
pub use mixer::{
    compute_rms, downmix_to_mono, resample_linear, AudioChannel, AudioChunk, AudioLevelMeter, AudioMixer,
    Channel, VadConfig, DEFAULT_RMS_THRESHOLD, DEFAULT_TURN_SILENCE_SECS, TARGET_SAMPLE_RATE,
};
pub use sck_audio::SckAudioCapture;
pub use stt_dispatcher::{
    channel_to_speaker, emit_outcome, generate_turn_id, AsyncSttWorker, SttChunk, SttDispatcher,
    SttEngineType, EVENT_STT_CHUNK, EVENT_STT_ENGINE_CHANGED, EVENT_STT_ERROR,
};
pub use whisper::{
    download_model, get_models_dir, is_metal_supported, list_available_models, resolve_model_path,
    LocalWhisperEngine, ModelAssetInfo, TranscriptionResult, WhisperConfig, WhisperEngine,
};

/// Tauri event names emitted to frontend
pub const EVENT_AUDIO_TURN_COMPLETED: &str = "sidekick://audio_turn_completed";
pub const EVENT_AUDIO_STATUS_CHANGED: &str = "sidekick://audio_status_changed";
pub const EVENT_AUDIO_LEVEL: &str = "sidekick://audio_level";
pub const EVENT_MIC_TEST_LEVEL: &str = "sidekick://mic_test_level";
pub const EVENT_STT_MODEL_DOWNLOAD_PROGRESS: &str = "sidekick://stt_model_download_progress";
pub const EVENT_STT_MODEL_DOWNLOAD_COMPLETED: &str = "sidekick://stt_model_download_completed";

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
    worker: Arc<AsyncSttWorker>,
    level_meter: Arc<AudioLevelMeter>,
    /// Serializes start and stop, so a second start cannot open a second stream while the first is opening
    lifecycle: Mutex<()>,
    /// Closed before streams stop, so late buffers never reach the mixer or the level meter
    sink_open: Arc<AtomicBool>,
    is_capturing: AtomicBool,
    is_panicked: Arc<AtomicBool>,
    /// Microphone the user picked, by name; `None` is the system default
    mic_device: Mutex<Option<String>>,
    /// Running microphone test (mic only, no transcription)
    mic_test: Mutex<Option<MicAudioCapture>>,
    /// Closed before the test stream stops, so late buffers emit no level events
    mic_test_open: Arc<AtomicBool>,
}

impl Default for AudioState {
    fn default() -> Self {
        Self::with_dispatcher(Arc::new(SttDispatcher::default()))
    }
}

impl AudioState {
    /// Creates a state with a custom STT dispatcher (useful for tests)
    pub fn with_dispatcher(dispatcher: Arc<SttDispatcher>) -> Self {
        let is_panicked = Arc::new(AtomicBool::new(false));
        let worker = Arc::new(AsyncSttWorker::new(dispatcher.clone(), is_panicked.clone()));

        Self {
            mixer: Arc::new(Mutex::new(AudioMixer::default())),
            sck_stream: Arc::new(Mutex::new(None)),
            mic_stream: Arc::new(Mutex::new(None)),
            dispatcher,
            worker,
            level_meter: Arc::new(AudioLevelMeter::default()),
            lifecycle: Mutex::new(()),
            sink_open: Arc::new(AtomicBool::new(false)),
            is_capturing: AtomicBool::new(false),
            is_panicked,
            mic_device: Mutex::new(None),
            mic_test: Mutex::new(None),
            mic_test_open: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Access the underlying STT dispatcher
    pub fn dispatcher(&self) -> &Arc<SttDispatcher> {
        &self.dispatcher
    }

    /// Reloads model weights into the embedded Whisper engine
    pub fn reload_whisper_model(&self, model_name: &str) -> Result<PathBuf, String> {
        self.dispatcher.reload_whisper_model(model_name)
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

    /// Starts audio capture on both channels according to configuration.
    /// Returns plain-language warnings for any channel that did not start. Errs only when nothing started.
    /// Does nothing if capture is already running, so repeated starts never stack streams.
    pub fn start<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config: AudioCaptureConfig,
    ) -> Result<Vec<String>, String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        self.close_mic_test();
        if self.is_capturing.load(Ordering::SeqCst) {
            return Ok(Vec::new());
        }

        // Reset panic state when explicitly starting audio capture
        self.is_panicked.store(false, Ordering::SeqCst);
        self.level_meter.reset();
        self.sink_open.store(true, Ordering::SeqCst);

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

        let mut warnings = Vec::new();

        // 2. Channel 0: ScreenCaptureKit System Audio (Interviewer)
        if config.capture_interviewer {
            match SckAudioCapture::start(TARGET_SAMPLE_RATE, self.channel_sink(app.clone(), Channel::Interviewer)) {
                Ok(sck) => {
                    let mut guard = self.sck_stream.lock().map_err(|e| e.to_string())?;
                    *guard = Some(sck);
                }
                Err(e) => {
                    eprintln!("[Sidekick Audio] ScreenCaptureKit startup warning: {e}");
                    warnings.push(friendly_warning(Channel::Interviewer, &e));
                }
            }
        } else {
            let old = self.sck_stream.lock().map_err(|e| e.to_string())?.take();
            if let Some(mut stream) = old {
                stream.stop();
            }
        }

        // 3. Channel 1: Candidate Microphone Audio, from the chosen device when it is still connected
        if config.capture_candidate {
            let chosen = self.mic_device.lock().map_err(|e| e.to_string())?.clone();
            let device = match chosen {
                Some(name) if !mic_audio::input_device_present(&name) => {
                    warnings.push(format!("Microphone '{name}' wasn't found, so the default microphone is used."));
                    None
                }
                other => other,
            };
            match MicAudioCapture::start(device.as_deref(), self.channel_sink(app.clone(), Channel::Candidate)) {
                Ok(mic) => {
                    let mut guard = self.mic_stream.lock().map_err(|e| e.to_string())?;
                    *guard = Some(mic);
                }
                Err(e) => {
                    eprintln!("[Sidekick Audio] Microphone startup warning: {e}");
                    warnings.push(friendly_warning(Channel::Candidate, &e));
                }
            }
        } else {
            let old = self.mic_stream.lock().map_err(|e| e.to_string())?.take();
            if let Some(mut stream) = old {
                stream.stop();
            }
        }

        // purge() doesn't take `lifecycle`, so a panic can land while the streams were opening
        if self.is_panicked.load(Ordering::SeqCst) {
            self.close_streams();
            return Err("Audio capture was cancelled by panic".to_string());
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
                "warnings": warnings,
            }),
        );

        // Nothing started: the warnings say what to fix. Otherwise the session runs and the HUD shows them.
        if !any_active && !warnings.is_empty() {
            return Err(warnings.join(" "));
        }

        Ok(warnings)
    }

    /// Callback for one channel: meters its level, feeds the mixer, and queues finished turns for STT
    fn channel_sink<R: Runtime>(
        &self,
        app: AppHandle<R>,
        channel: Channel,
    ) -> impl Fn(&[f32], u32, u16) + Send + Sync + 'static {
        let mixer = self.mixer.clone();
        let worker = self.worker.clone();
        let meter = self.level_meter.clone();
        let sink_open = self.sink_open.clone();

        move |samples: &[f32], sample_rate: u32, channels: u16| {
            // Streams stop asynchronously, so late buffers must not reach the mixer or the meter
            if !sink_open.load(Ordering::SeqCst) {
                return;
            }
            if let Some((interviewer, candidate)) = meter.record(channel, samples) {
                emit_audio_level(&app, interviewer, candidate);
            }

            // Release the mixer mutex BEFORE emitting IPC events
            let maybe_chunk = if let Ok(mut mixer_guard) = mixer.lock() {
                mixer_guard.process_samples(channel, samples, sample_rate, channels)
            } else {
                None
            };

            // Decouple STT from real-time audio threads via bounded async queue
            if let Some(chunk) = maybe_chunk {
                let _ = app.emit(EVENT_AUDIO_TURN_COMPLETED, &chunk);
                let app_for_stt = app.clone();
                worker.try_enqueue(chunk, move |outcome| emit_outcome(&app_for_stt, &outcome));
            }
        }
    }

    /// Stops audio capture across all streams and notifies frontend
    pub fn stop<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        self.is_capturing.store(false, Ordering::SeqCst);
        self.close_streams();

        emit_audio_level(app, 0.0, 0.0);
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

    /// Starts the microphone test: opens only the selected microphone and emits `EVENT_MIC_TEST_LEVEL`.
    /// Does nothing if a test is already running.
    pub fn start_mic_test<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Stop listening before testing the microphone.".to_string());
        }
        if self.mic_test.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(());
        }

        let name = self.mic_device.lock().map_err(|e| e.to_string())?.clone();
        self.mic_test_open.store(true, Ordering::SeqCst);
        let open = self.mic_test_open.clone();
        let app = app.clone();
        let meter = Mutex::new(mic_audio::MicLevelWindow::default());
        let capture = MicAudioCapture::start(name.as_deref(), move |samples: &[f32], sample_rate: u32, channels: u16| {
            if !open.load(Ordering::SeqCst) {
                return;
            }
            let reading = meter.lock().ok().and_then(|mut m| m.push(samples, sample_rate, channels));
            if let Some((db, peak_db)) = reading {
                let _ = app.emit(EVENT_MIC_TEST_LEVEL, serde_json::json!({ "db": db, "peakDb": peak_db }));
            }
        })
        .map_err(|e| {
            self.mic_test_open.store(false, Ordering::SeqCst);
            friendly_warning(Channel::Candidate, &e)
        })?;

        *self.mic_test.lock().map_err(|e| e.to_string())? = Some(capture);
        // A purge that landed while the microphone was opening has already run, so the test must not outlive it
        if !self.mic_test_open.load(Ordering::SeqCst) {
            self.close_mic_test();
        }
        Ok(())
    }

    /// Stops the microphone test if one is running
    pub fn stop_mic_test(&self) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        self.close_mic_test();
        Ok(())
    }

    /// Stops the microphone test without taking `lifecycle`, so purge can call it. Stops are asynchronous,
    /// which is why the emit gate closes first.
    fn close_mic_test(&self) {
        self.mic_test_open.store(false, Ordering::SeqCst);
        let mic = self.mic_test.lock().ok().and_then(|mut g| g.take());
        if let Some(mut mic) = mic {
            mic.stop();
        }
    }

    /// Closes the sink, then stops both streams. Stops run outside the stream locks: the
    /// synchronous state query on the main thread also takes them.
    fn close_streams(&self) {
        self.sink_open.store(false, Ordering::SeqCst);
        let sck = self.sck_stream.lock().ok().and_then(|mut g| g.take());
        if let Some(mut stream) = sck {
            stream.stop();
        }
        let mic = self.mic_stream.lock().ok().and_then(|mut g| g.take());
        if let Some(mut stream) = mic {
            stream.stop();
        }
    }

    /// Synchronously halts all audio streams and purges memory buffers in < 25ms (REQ-004, SEC-003)
    pub fn purge(&self) {
        let start = std::time::Instant::now();
        self.is_panicked.store(true, Ordering::SeqCst);
        self.sink_open.store(false, Ordering::SeqCst);
        self.is_capturing.store(false, Ordering::SeqCst);

        if let Ok(mut guard) = self.sck_stream.lock() {
            if let Some(stream) = guard.take() {
                // The bridge stop can wait up to 2 s, so it runs off the panic path
                std::thread::spawn(move || drop(stream));
            }
        }

        if let Ok(mut guard) = self.mic_stream.lock() {
            if let Some(mut stream) = guard.take() {
                stream.stop();
            }
        }
        self.close_mic_test();

        if let Ok(mut mixer) = self.mixer.lock() {
            mixer.purge();
        }

        let elapsed = start.elapsed();
        if elapsed.as_millis() > 25 {
            eprintln!("[Sidekick Audio] Warning: AudioState::purge exceeded 25ms: {:?}", elapsed);
        }
    }
}

const SCREEN_RECORDING_HINT: &str = "Turn on Sidekick (or the app you started it from, such as Terminal) in System Settings → Privacy & Security → Screen Recording, then restart Sidekick.";
const MICROPHONE_HINT: &str = "Turn on Sidekick (or the app you started it from, such as Terminal) in System Settings → Privacy & Security → Microphone, then restart Sidekick.";

/// Plain-language startup warning for one channel, saying what the user can do next
fn friendly_warning(channel: Channel, raw: &str) -> String {
    match (channel, raw) {
        (Channel::Interviewer, sck_audio::SCREEN_RECORDING_DENIED) => {
            format!("System audio is off: Screen Recording isn't allowed. {SCREEN_RECORDING_HINT}")
        }
        (Channel::Interviewer, _) => format!("System audio is off: {raw}"),
        (Channel::Candidate, mic_audio::MIC_ACCESS_DENIED) => {
            format!("Microphone is off: access is denied or restricted. {MICROPHONE_HINT}")
        }
        (Channel::Candidate, _) => format!("Microphone is off: {raw}"),
    }
}

fn emit_audio_level<R: Runtime>(app: &AppHandle<R>, interviewer: f32, candidate: f32) {
    let _ = app.emit(
        EVENT_AUDIO_LEVEL,
        serde_json::json!({ "interviewer": interviewer, "candidate": candidate }),
    );
}

const ENGLISH_ONLY_MODEL_MESSAGE: &str =
    "The on-device model only understands English. Switch to Groq or Deepgram for other languages.";
const DEEPGRAM_ARABIC_MESSAGE: &str =
    "Deepgram may not transcribe Arabic with its current model. If captions fail, switch to Groq.";

/// Warns when the on-device model cannot transcribe the chosen language (`.en` models are English-only)
fn english_only_model_warning(engine: SttEngineType, model_filename: &str, language: &str) -> Option<String> {
    let english_only = model_filename.ends_with(".en.bin");
    (engine == SttEngineType::WhisperLocal && english_only && language != "en")
        .then(|| ENGLISH_ONLY_MODEL_MESSAGE.to_string())
}

/// Warns when Deepgram's current model may not transcribe Arabic
fn deepgram_arabic_warning(engine: SttEngineType, language: &str) -> Option<String> {
    (engine == SttEngineType::Deepgram && language == "ar").then(|| DEEPGRAM_ARABIC_MESSAGE.to_string())
}

pub mod commands {
    use super::*;
    use std::str::FromStr;
    use tauri::State;

    /// Starts audio capture via ScreenCaptureKit (interviewer) and Microphone (candidate).
    /// Returns warnings for a partial start. Async so the blocking ScreenCaptureKit start runs off the main thread.
    #[tauri::command]
    pub async fn start_audio_capture(
        app: AppHandle,
        config: Option<AudioCaptureConfig>,
    ) -> Result<Vec<String>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<AudioState>().start(&app, config.unwrap_or_default())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Halts active audio capture pipelines
    #[tauri::command]
    pub async fn stop_audio_capture(app: AppHandle) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || app.state::<AudioState>().stop(&app))
            .await
            .map_err(|e| e.to_string())?
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

    /// Downloads a local STT model asset directly into Application Support models directory
    #[tauri::command]
    pub async fn download_stt_model(
        app: AppHandle,
        state: State<'_, AudioState>,
        model_name: String,
    ) -> Result<String, String> {
        let app_handle = app.clone();
        let model_key = model_name.clone();

        let path = whisper::download_model(&model_name, Some(move |downloaded, total| {
            let _ = app_handle.emit(EVENT_STT_MODEL_DOWNLOAD_PROGRESS, serde_json::json!({
                "model": model_key,
                "downloaded_bytes": downloaded,
                "total_bytes": total,
            }));
        })).await?;

        // Attempt loading the newly downloaded model weights
        let _ = state.reload_whisper_model(&model_name);

        let _ = app.emit(EVENT_STT_MODEL_DOWNLOAD_COMPLETED, serde_json::json!({
            "model": model_name,
            "path": path.to_string_lossy(),
        }));

        Ok(path.to_string_lossy().to_string())
    }

    /// Lists connected microphones; the system default is marked `isDefault`. Async because CoreAudio
    /// enumeration can stall on Bluetooth devices, so it runs off the main thread.
    #[tauri::command]
    pub async fn list_input_devices() -> Result<Vec<mic_audio::InputDevice>, String> {
        tauri::async_runtime::spawn_blocking(mic_audio::list_input_devices)
            .await
            .map_err(|e| e.to_string())?
    }

    /// Picks the microphone for the next start or mic test; `None` is the system default
    #[tauri::command]
    pub fn set_mic_device(state: State<'_, AudioState>, name: Option<String>) -> Result<(), String> {
        let name = name.filter(|n| !n.trim().is_empty());
        *state.mic_device.lock().map_err(|e| e.to_string())? = name;
        Ok(())
    }

    /// Sets the transcription language ("auto" or an ISO-639-1 code). Returns a warning when the
    /// selected engine may not transcribe that language.
    #[tauri::command]
    pub fn set_stt_language(state: State<'_, AudioState>, language: String) -> Result<Option<String>, String> {
        state.dispatcher.set_language(&language)?;
        let engine_type = state.dispatcher.get_engine();
        let local = state.dispatcher.local_whisper();
        let language = local.language();
        Ok(english_only_model_warning(engine_type, &whisper::normalize_model_filename(&local.model_name()), &language)
            .or_else(|| deepgram_arabic_warning(engine_type, &language)))
    }

    /// Starts the microphone test (mic only, no transcription). Async so the blocking microphone start runs off the main thread.
    #[tauri::command]
    pub async fn start_mic_test(app: AppHandle) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || app.state::<AudioState>().start_mic_test(&app))
            .await
            .map_err(|e| e.to_string())?
    }

    /// Stops the microphone test
    #[tauri::command]
    pub async fn stop_mic_test(app: AppHandle) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || app.state::<AudioState>().stop_mic_test())
            .await
            .map_err(|e| e.to_string())?
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

    #[test]
    fn test_friendly_warning_explains_denied_permissions() {
        assert_eq!(
            friendly_warning(Channel::Interviewer, sck_audio::SCREEN_RECORDING_DENIED),
            "System audio is off: Screen Recording isn't allowed. Turn on Sidekick (or the app you started it from, such as Terminal) in System Settings → Privacy & Security → Screen Recording, then restart Sidekick."
        );
        assert_eq!(
            friendly_warning(Channel::Candidate, mic_audio::MIC_ACCESS_DENIED),
            "Microphone is off: access is denied or restricted. Turn on Sidekick (or the app you started it from, such as Terminal) in System Settings → Privacy & Security → Microphone, then restart Sidekick."
        );
    }

    #[test]
    fn test_friendly_warning_keeps_other_errors() {
        assert_eq!(friendly_warning(Channel::Interviewer, "no display"), "System audio is off: no display");
        assert_eq!(friendly_warning(Channel::Candidate, "no device"), "Microphone is off: no device");
    }

    #[test]
    fn test_english_only_model_warning_rule() {
        assert_eq!(
            english_only_model_warning(SttEngineType::WhisperLocal, "ggml-tiny.en.bin", "hi").as_deref(),
            Some("The on-device model only understands English. Switch to Groq or Deepgram for other languages.")
        );
        assert!(english_only_model_warning(SttEngineType::WhisperLocal, "ggml-tiny.en.bin", "auto").is_some());
        assert_eq!(english_only_model_warning(SttEngineType::WhisperLocal, "ggml-tiny.en.bin", "en"), None);
        assert_eq!(english_only_model_warning(SttEngineType::Groq, "ggml-tiny.en.bin", "hi"), None);
        assert_eq!(english_only_model_warning(SttEngineType::WhisperLocal, "ggml-base.bin", "hi"), None);
    }

    #[test]
    fn test_deepgram_arabic_warning_rule() {
        assert_eq!(
            deepgram_arabic_warning(SttEngineType::Deepgram, "ar").as_deref(),
            Some("Deepgram may not transcribe Arabic with its current model. If captions fail, switch to Groq.")
        );
        assert_eq!(deepgram_arabic_warning(SttEngineType::Groq, "ar"), None);
        assert_eq!(deepgram_arabic_warning(SttEngineType::WhisperLocal, "ar"), None);
        assert_eq!(deepgram_arabic_warning(SttEngineType::Deepgram, "hi"), None);
        assert_eq!(deepgram_arabic_warning(SttEngineType::Deepgram, "auto"), None);
    }

    #[test]
    fn test_stop_mic_test_without_test_is_ok() {
        let state = AudioState::default();
        assert!(state.stop_mic_test().is_ok());
        assert!(state.mic_test.lock().unwrap().is_none());
    }

    #[test]
    fn test_mic_status_blocks_only_denied_or_restricted() {
        assert!(!mic_audio::mic_status_blocks(0), "not determined must still open, so macOS can prompt");
        assert!(mic_audio::mic_status_blocks(1), "restricted");
        assert!(mic_audio::mic_status_blocks(2), "denied");
        assert!(!mic_audio::mic_status_blocks(3), "authorized");
    }
}
